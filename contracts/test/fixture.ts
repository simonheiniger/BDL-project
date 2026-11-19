import { ethers } from "hardhat";
import { time, mine } from "@nomicfoundation/hardhat-network-helpers";
import type { PetNFT, Arena, PetHouse, PetGames } from "../typechain-types";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

export const MINT_PRICE = ethers.parseEther("0.01");

/** Deploy aller Contracts. cooldown/maxPerDay steuerbar (Tests: 0 / gross = schnell leveln). */
export async function deployAll(cooldown = 0n, maxPerDay = 1000n) {
  const [deployer, alice, bob, carol, host, checkin, gamer] = await ethers.getSigners();

  const registry = await ethers.deployContract("ERC6551Registry");
  const accountImpl = await ethers.deployContract("PetAccount");
  const pets = await ethers.deployContract("PetNFT", [
    await registry.getAddress(),
    await accountImpl.getAddress(),
    MINT_PRICE,
    cooldown,
    maxPerDay,
  ]);
  const decor = await ethers.deployContract("PetDecor");
  const bodies = await ethers.deployContract("SpriteBodies");
  const extras = await ethers.deployContract("SpriteExtras");
  const renderer = await ethers.deployContract("PetRenderer", [await decor.getAddress(), await bodies.getAddress(), await extras.getAddress()]);
  await pets.setRenderer(await renderer.getAddress());
  const cosmetics = await ethers.deployContract("Cosmetics", ["ipfs://cosmetics/{id}.json"]);
  const trophy = await ethers.deployContract("Trophy");
  const arena = await ethers.deployContract("Arena", [
    await pets.getAddress(),
    await trophy.getAddress(),
    checkin.address,
  ]);
  const market = await ethers.deployContract("Marketplace", [await pets.getAddress()]);
  const houses = await ethers.deployContract("PetHouse");
  await houses.setPets(await pets.getAddress());
  await pets.setHouses(await houses.getAddress());
  const games = await ethers.deployContract("PetGames", [await pets.getAddress(), gamer.address]);
  await pets.setGames(await games.getAddress());

  await pets.setGameContracts(await cosmetics.getAddress(), await trophy.getAddress());
  await trophy.setRoles(await arena.getAddress(), await pets.getAddress());
  await cosmetics.addItem("Zylinder", ethers.parseEther("0.001"), 100);
  await cosmetics.addItem("Sonnenbrille", ethers.parseEther("0.002"), 2);
  await cosmetics.addItem("Krone", ethers.parseEther("0.02"), 50);

  return { deployer, alice, bob, carol, host, checkin, registry, accountImpl, renderer, pets, cosmetics, trophy, arena, market, houses, games, gamer };
}

/** Schluessel des (simulierten) NFC-Chips eines Hauses: deterministisch aus der houseId, damit Tests zustandslos bleiben */
export const tagWallet = (houseId: bigint) => new ethers.Wallet(ethers.id(`bdl-test-tag-${houseId}`));

/** Haus mit Chip praegen (Owner = Deployer praegt, `to` bekommt es). tier 0..4 = Huette..Villa */
export async function mintHouse(houses: PetHouse, to: string, tier = 4) {
  const [deployer] = await ethers.getSigners();
  const id = await houses.nextHouseId();
  await houses.connect(deployer).mintHouse(to, tier, tagWallet(id).address);
  return id;
}

/** Pet minten. Ohne `houseId` bekommt der Spieler ein neues Haus (Villa, 5 Plaetze). */
export async function mintPet(pets: PetNFT, who: HardhatEthersSigner, houseId?: bigint) {
  const houses = await ethers.getContractAt("PetHouse", await pets.houses());
  houseId ??= await mintHouse(houses, who.address);
  const tx = await pets.connect(who).mint(houseId, { value: MINT_PRICE });
  const rc = await tx.wait();
  const ev = rc!.logs.map((l) => pets.interface.parseLog(l)).find((e) => e?.name === "Minted")!;
  return { id: ev.args.petId as bigint, account: ev.args.account as string, houseId };
}

/** NFC-Scan simulieren: Chip-Schluessel signiert Spieler/Pet/Haus/Nonce/Ablauf (EIP-712) */
export async function signScan(houses: PetHouse, player: string, petId: bigint, expiryIn = 600) {
  const houseId = await houses.houseOf(petId);
  const nonce = (await houses.houses(houseId)).nonce;
  const expiry = BigInt(await time.latest()) + BigInt(expiryIn);
  const { chainId } = await ethers.provider.getNetwork();
  const sig = await tagWallet(houseId).signTypedData(
    { name: "BDL Pet House", version: "1", chainId, verifyingContract: await houses.getAddress() },
    {
      Scan: [
        { name: "player", type: "address" },
        { name: "petId", type: "uint256" },
        { name: "houseId", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "expiry", type: "uint256" },
      ],
    },
    { player, petId, houseId, nonce, expiry },
  );
  return { expiry, sig };
}

/** Einmal pflegen (inkl. Scan). 0=Train/STR, 1=Play/AGI, 2=Puzzle/INT, 3=Feed/VIT */
export async function care(pets: PetNFT, who: HardhatEthersSigner, id: bigint, action = 3) {
  const houses = await ethers.getContractAt("PetHouse", await pets.houses());
  const { expiry, sig } = await signScan(houses, who.address, id);
  return pets.connect(who).interact(id, action, expiry, sig, { value: await pets.careFee() });
}

/** n Pflegen mit Scan */
export async function interactN(pets: PetNFT, who: HardhatEthersSigner, id: bigint, n: number, action = 3) {
  for (let i = 0; i < n; i++) await (await care(pets, who, id, action)).wait();
}

/** EIP-712 Check-in-Signatur, wie sie der Check-in-Service ausstellt */
export async function signCheckIn(
  arena: Arena,
  signer: HardhatEthersSigner,
  player: string,
  petId: bigint,
  tournamentId: bigint,
  expiry: bigint,
) {
  const { chainId } = await ethers.provider.getNetwork();
  return signer.signTypedData(
    { name: "BDL Pet Arena", version: "1", chainId, verifyingContract: await arena.getAddress() },
    {
      CheckIn: [
        { name: "player", type: "address" },
        { name: "petId", type: "uint256" },
        { name: "tournamentId", type: "uint256" },
        { name: "expiry", type: "uint256" },
      ],
    },
    { player, petId, tournamentId, expiry },
  );
}

export const seedOf = (s: string) => ethers.id(s); // bytes32
export const commitOf = (seed: string) => ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["bytes32"], [seed]));
export const zone = (g: string) => ethers.zeroPadBytes(ethers.toUtf8Bytes(g), 8) as `0x${string}`;

/** Turnier anlegen, Pets joinen lassen, schliessen, revealen. Gibt Settled-Event-Args zurueck. */
export async function runTournament(
  arena: Arena,
  checkin: HardhatEthersSigner,
  host: HardhatEthersSigner,
  players: { who: HardhatEthersSigner; petId: bigint }[],
  entryFee = ethers.parseEther("0.01"),
  seedLabel = "seed",
) {
  const now = BigInt(await time.latest());
  const seed = seedOf(seedLabel);
  await arena.createTournament(zone("u0qj8b"), now, now + 3600n, entryFee, commitOf(seed), host.address);
  const tid = await arena.tournamentCount();
  for (const p of players) {
    const expiry = now + 600n;
    const sig = await signCheckIn(arena, checkin, p.who.address, p.petId, tid, expiry);
    await arena.connect(p.who).join(tid, p.petId, expiry, sig, { value: entryFee });
  }
  await time.increase(3601);
  await arena.close(tid);
  await mine(1);
  const rc = await (await arena.reveal(tid, seed)).wait();
  const ev = rc!.logs.map((l) => arena.interface.parseLog(l)).find((e) => e?.name === "Settled");
  return { tid, settled: ev?.args };
}

/** JS-Referenz der Solidity-Formeln (GameMath) – Tests pruefen Gleichheit */
export const ref = {
  xpToNext: (L: bigint) => (50n * L * sqrtBig(L * 1_000_000n)) / 1000n,
  fuseStat: (a: bigint, b: bigint, fc: bigint) => {
    const hi = a > b ? a : b;
    const lo = a > b ? b : a;
    const v = hi + (lo * 3000n) / (10_000n * (1n + fc));
    return v > 200n ? 200n : v;
  },
  totalXp: (level: bigint, xp: bigint) => {
    let t = xp;
    for (let l = 1n; l < level; l++) t += ref.xpToNext(l);
    return t;
  },
  levelFromXp: (total: bigint): [bigint, bigint] => {
    let level = 1n;
    while (level < 50n && total >= ref.xpToNext(level)) {
      total -= ref.xpToNext(level);
      level++;
    }
    return [level, level === 50n ? 0n : total];
  },
};

function sqrtBig(n: bigint) {
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

/** Spiel-Gutschein, wie ihn der Spiele-Server (api/game.ts) ausstellt */
export async function signVoucher(
  games: PetGames,
  signer: HardhatEthersSigner,
  v: { player: string; petId: bigint; kind: number; xp: number; nonce: bigint; expiry: bigint },
) {
  const { chainId } = await ethers.provider.getNetwork();
  return signer.signTypedData(
    { name: "BDL Pet Games", version: "1", chainId, verifyingContract: await games.getAddress() },
    {
      Voucher: [
        { name: "player", type: "address" },
        { name: "petId", type: "uint256" },
        { name: "kind", type: "uint8" },
        { name: "xp", type: "uint16" },
        { name: "nonce", type: "uint256" },
        { name: "expiry", type: "uint64" },
      ],
    },
    v,
  );
}
