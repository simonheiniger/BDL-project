import { ethers } from "hardhat";
import { time, mine } from "@nomicfoundation/hardhat-network-helpers";
import type { PetNFT, Arena } from "../typechain-types";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

export const MINT_PRICE = ethers.parseEther("0.01");

/** Deploy aller Contracts. cooldown/maxPerDay steuerbar (Tests: 0 / gross = schnell leveln). */
export async function deployAll(cooldown = 0n, maxPerDay = 1000n) {
  const [deployer, alice, bob, carol, host, checkin] = await ethers.getSigners();

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
  const anatomy = await ethers.deployContract("PetAnatomy");
  const renderer = await ethers.deployContract("PetRenderer", [await decor.getAddress(), await anatomy.getAddress()]);
  await pets.setRenderer(await renderer.getAddress());
  const cosmetics = await ethers.deployContract("Cosmetics", ["ipfs://cosmetics/{id}.json"]);
  const trophy = await ethers.deployContract("Trophy");
  const arena = await ethers.deployContract("Arena", [
    await pets.getAddress(),
    await trophy.getAddress(),
    checkin.address,
  ]);
  const market = await ethers.deployContract("Marketplace", [await pets.getAddress()]);

  await pets.setGameContracts(await cosmetics.getAddress(), await trophy.getAddress());
  await trophy.setRoles(await arena.getAddress(), await pets.getAddress());
  await cosmetics.addItem("Zylinder", ethers.parseEther("0.001"), 100);
  await cosmetics.addItem("Sonnenbrille", ethers.parseEther("0.002"), 2);
  await cosmetics.addItem("Krone", ethers.parseEther("0.02"), 50);

  return { deployer, alice, bob, carol, host, checkin, registry, accountImpl, renderer, pets, cosmetics, trophy, arena, market };
}

export async function mintPet(pets: PetNFT, who: HardhatEthersSigner) {
  const tx = await pets.connect(who).mint({ value: MINT_PRICE });
  const rc = await tx.wait();
  const ev = rc!.logs.map((l) => pets.interface.parseLog(l)).find((e) => e?.name === "Minted")!;
  return { id: ev.args.petId as bigint, account: ev.args.account as string };
}

/** n Interaktionen einer Aktion (0=Train/STR, 1=Play/AGI, 2=Puzzle/INT, 3=Feed/VIT) */
export async function interactN(pets: PetNFT, who: HardhatEthersSigner, id: bigint, n: number, action = 3) {
  for (let i = 0; i < n; i++) await pets.connect(who).interact(id, action);
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
