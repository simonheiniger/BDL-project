import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time, mine } from "@nomicfoundation/hardhat-network-helpers";
import {
  deployAll,
  mintPet,
  interactN,
  signCheckIn,
  runTournament,
  commitOf,
  seedOf,
  zone,
  ref,
} from "./fixture";

const fast = () => deployAll();
const prod = () => deployAll(60n, 6n);

describe("ERC-6551: Registry + PetAccount", () => {
  it("Mint erzeugt TBA an deterministischer Adresse, gebunden an das Pet", async () => {
    const { pets, alice } = await loadFixture(fast);
    const { id, account } = await mintPet(pets, alice);
    expect(await pets.accountOf(id)).to.equal(account);

    const acc = await ethers.getContractAt("PetAccount", account);
    const [chainId, tokenContract, tokenId] = await acc.token();
    expect(chainId).to.equal(31337n);
    expect(tokenContract).to.equal(await pets.getAddress());
    expect(tokenId).to.equal(id);
    expect(await acc.owner()).to.equal(alice.address);
  });

  it("Nur NFT-Owner darf execute(); state zaehlt hoch", async () => {
    const { pets, alice, bob } = await loadFixture(fast);
    const { account } = await mintPet(pets, alice);
    const acc = await ethers.getContractAt("PetAccount", account);
    await alice.sendTransaction({ to: account, value: ethers.parseEther("1") });

    await expect(acc.connect(bob).execute(bob.address, 1n, "0x", 0)).to.be.revertedWithCustomError(acc, "NotAuthorized");
    await expect(acc.connect(alice).execute(bob.address, 1n, "0x", 0)).to.changeEtherBalance(bob, 1n);
    expect(await acc.state()).to.equal(1n);
  });

  it("Kontrolle wechselt mit dem NFT", async () => {
    const { pets, alice, bob } = await loadFixture(fast);
    const { id, account } = await mintPet(pets, alice);
    const acc = await ethers.getContractAt("PetAccount", account);
    await pets.connect(alice).transferFrom(alice.address, bob.address, id);
    expect(await acc.owner()).to.equal(bob.address);
    await expect(acc.connect(alice).execute(alice.address, 0n, "0x", 0)).to.be.revertedWithCustomError(acc, "NotAuthorized");
  });

  it("approve/setApprovalForAll aus dem TBA gesperrt", async () => {
    const { pets, cosmetics, alice, bob } = await loadFixture(fast);
    const { account } = await mintPet(pets, alice);
    const acc = await ethers.getContractAt("PetAccount", account);
    const data = cosmetics.interface.encodeFunctionData("setApprovalForAll", [bob.address, true]);
    await expect(acc.connect(alice).execute(await cosmetics.getAddress(), 0n, data, 0)).to.be.revertedWithCustomError(
      acc,
      "ApprovalsDisabled",
    );
  });

  it("Pet kann nicht in die eigene Wallet transferiert werden (Ownership-Zyklus)", async () => {
    const { pets, alice } = await loadFixture(fast);
    const { id, account } = await mintPet(pets, alice);
    await expect(pets.connect(alice).transferFrom(alice.address, account, id)).to.be.revertedWithCustomError(
      pets,
      "SelfOwnership",
    );
  });

  it("sweepTo nur durch PetNFT", async () => {
    const { pets, cosmetics, alice } = await loadFixture(fast);
    const { account } = await mintPet(pets, alice);
    const acc = await ethers.getContractAt("PetAccount", account);
    await expect(acc.connect(alice).sweepTo(alice.address, await cosmetics.getAddress(), 32)).to.be.revertedWithCustomError(
      acc,
      "NotAuthorized",
    );
  });
});

describe("PetNFT: Mint + Pflege-Loop", () => {
  it("Mint-Preis wird erzwungen, Start-Stats 5..15, Level 1", async () => {
    const { pets, alice } = await loadFixture(fast);
    await expect(pets.connect(alice).mint({ value: 1n })).to.be.revertedWithCustomError(pets, "WrongPayment");
    const { id } = await mintPet(pets, alice);
    const p = await pets.getPet(id);
    expect(p.level).to.equal(1n);
    for (const s of p.stats) {
      expect(s).to.be.gte(5n);
      expect(s).to.be.lte(15n);
    }
  });

  it("XP-Kurve: 42 Aktionen -> Lv4, 43 Aktionen (860 XP >= 850) -> Lv5", async () => {
    const { pets, alice } = await loadFixture(fast);
    const { id } = await mintPet(pets, alice);
    const need = [1n, 2n, 3n, 4n].map(ref.xpToNext);
    expect(need).to.deep.equal([50n, 141n, 259n, 400n]);
    await interactN(pets, alice, id, 42);
    expect((await pets.getPet(id)).level).to.equal(4n);
    await interactN(pets, alice, id, 1);
    const p = await pets.getPet(id);
    expect(p.level).to.equal(5n);
    expect(p.xp).to.equal(860n - 850n);
  });

  it("Level-Up: alle Stats +1, Fokus-Stat +3", async () => {
    const { pets, alice } = await loadFixture(fast);
    const { id } = await mintPet(pets, alice);
    const before = (await pets.getPet(id)).stats;
    await interactN(pets, alice, id, 3, 0); // 60 XP Train -> Lv2, Fokus STR
    const after = (await pets.getPet(id)).stats;
    expect(after[0] - before[0]).to.equal(3n);
    expect(after[1] - before[1]).to.equal(1n);
    expect(after[2] - before[2]).to.equal(1n);
    expect(after[3] - before[3]).to.equal(1n);
  });

  it("Nur Owner darf pflegen", async () => {
    const { pets, alice, bob } = await loadFixture(fast);
    const { id } = await mintPet(pets, alice);
    await expect(pets.connect(bob).interact(id, 0)).to.be.revertedWithCustomError(pets, "NotPetOwner");
  });

  it("Cooldown + Tageslimit (Produktions-Config 60s / 6 pro Tag)", async () => {
    const { pets, alice } = await loadFixture(prod);
    const { id } = await mintPet(pets, alice);
    await pets.connect(alice).interact(id, 3);
    await expect(pets.connect(alice).interact(id, 3)).to.be.revertedWithCustomError(pets, "Cooldown");
    for (let i = 0; i < 5; i++) {
      await time.increase(61);
      await pets.connect(alice).interact(id, 3);
    }
    await time.increase(61);
    await expect(pets.connect(alice).interact(id, 3)).to.be.revertedWithCustomError(pets, "DailyLimit");
    await time.increase(86400);
    await pets.connect(alice).interact(id, 3);
  });

  it("tokenURI ist gueltiges on-chain JSON", async () => {
    const { pets, alice } = await loadFixture(fast);
    const { id } = await mintPet(pets, alice);
    const uri = await pets.tokenURI(id);
    const json = JSON.parse(Buffer.from(uri.split(",")[1], "base64").toString());
    expect(json.name).to.equal(`BLD Pet #${id}`);
    expect(json.attributes[0]).to.deep.equal({ trait_type: "Level", value: 1 });
  });
});

describe("Cosmetics", () => {
  it("Kauf direkt ins TBA, Preis + MaxSupply erzwungen", async () => {
    const { pets, cosmetics, alice } = await loadFixture(fast);
    const { account } = await mintPet(pets, alice);
    await cosmetics.connect(alice).buy(2, 2, account, { value: ethers.parseEther("0.004") });
    expect(await cosmetics.balanceOf(account, 2)).to.equal(2n);
    await expect(cosmetics.connect(alice).buy(2, 1, account, { value: ethers.parseEther("0.002") })).to.be.revertedWithCustomError(
      cosmetics,
      "SoldOut",
    );
    await expect(cosmetics.connect(alice).buy(1, 1, account, { value: 1n })).to.be.revertedWithCustomError(
      cosmetics,
      "WrongPayment",
    );
  });
});

describe("Arena", () => {
  async function setup() {
    const f = await deployAll();
    const a = await mintPet(f.pets, f.alice);
    const b = await mintPet(f.pets, f.bob);
    return { ...f, a, b };
  }

  it("Gewinner bekommt Soulbound-Trophy + 70 % Pool im TBA; Host 20 %, Treasury 10 %", async () => {
    const { arena, trophy, checkin, host, alice, bob, deployer, a, b } = await loadFixture(setup);
    const { settled } = await runTournament(arena, checkin, host, [
      { who: alice, petId: a.id },
      { who: bob, petId: b.id },
    ]);
    const winnerAcc = settled!.winnerPet === a.id ? a.account : b.account;
    expect(await trophy.balanceOf(winnerAcc)).to.equal(1n);
    expect(await ethers.provider.getBalance(winnerAcc)).to.equal(ethers.parseEther("0.014"));
    expect(await arena.pending(host.address)).to.equal(ethers.parseEther("0.004"));
    expect(await arena.pending(deployer.address)).to.equal(ethers.parseEther("0.002"));
    expect(await trophy.locked(1)).to.equal(true);
  });

  it("Falsche / fremde Check-in-Signatur wird abgelehnt", async () => {
    const { arena, host, alice, bob, a } = await loadFixture(setup);
    const now = BigInt(await time.latest());
    await arena.createTournament(zone("u0qj8b"), now, now + 3600n, 0, commitOf(seedOf("x")), host.address);
    const sig = await signCheckIn(arena, bob, alice.address, a.id, 1n, now + 600n); // bob ist nicht der Signer
    await expect(arena.connect(alice).join(1, a.id, now + 600n, sig)).to.be.revertedWithCustomError(arena, "BadSignature");
  });

  it("Signatur ist an Spieler gebunden (kein Weiterreichen)", async () => {
    const { arena, host, checkin, alice, bob, a, b } = await loadFixture(setup);
    const now = BigInt(await time.latest());
    await arena.createTournament(zone("u0qj8b"), now, now + 3600n, 0, commitOf(seedOf("x")), host.address);
    const sig = await signCheckIn(arena, checkin, alice.address, a.id, 1n, now + 600n);
    await expect(arena.connect(bob).join(1, b.id, now + 600n, sig)).to.be.revertedWithCustomError(arena, "BadSignature");
  });

  it("Reveal mit falschem Seed scheitert; ohne Reveal -> Refund nach Fenster", async () => {
    const { arena, host, checkin, alice, a } = await loadFixture(setup);
    const now = BigInt(await time.latest());
    const fee = ethers.parseEther("0.01");
    await arena.createTournament(zone("u0qj8b"), now, now + 3600n, fee, commitOf(seedOf("richtig")), host.address);
    const sig = await signCheckIn(arena, checkin, alice.address, a.id, 1n, now + 600n);
    await arena.connect(alice).join(1, a.id, now + 600n, sig, { value: fee });
    await time.increase(3601);
    await arena.close(1);
    await mine(1);
    await expect(arena.reveal(1, seedOf("falsch"))).to.be.revertedWithCustomError(arena, "BadReveal");
    await expect(arena.refund(1)).to.be.revertedWithCustomError(arena, "NotInWindow");
    await mine(200);
    await arena.refund(1);
    expect(await arena.pending(alice.address)).to.equal(fee);
    await expect(arena.connect(alice).withdraw()).to.changeEtherBalance(alice, fee);
  });

  it("Doppelte Anmeldung (gleicher Spieler) verboten", async () => {
    const { arena, host, checkin, alice, pets, a } = await loadFixture(setup);
    const a2 = await mintPet(pets, alice);
    const now = BigInt(await time.latest());
    await arena.createTournament(zone("u0qj8b"), now, now + 3600n, 0, commitOf(seedOf("x")), host.address);
    await arena.connect(alice).join(1, a.id, now + 600n, await signCheckIn(arena, checkin, alice.address, a.id, 1n, now + 600n));
    await expect(
      arena.connect(alice).join(1, a2.id, now + 600n, await signCheckIn(arena, checkin, alice.address, a2.id, 1n, now + 600n)),
    ).to.be.revertedWithCustomError(arena, "AlreadyJoined");
  });

  it("Trophy ist soulbound (kein Transfer aus dem TBA)", async () => {
    const { arena, trophy, checkin, host, alice, bob, a, b } = await loadFixture(setup);
    const { settled } = await runTournament(arena, checkin, host, [
      { who: alice, petId: a.id },
      { who: bob, petId: b.id },
    ]);
    const [winner, winAcc] = settled!.winnerPet === a.id ? [alice, a.account] : [bob, b.account];
    const acc = await ethers.getContractAt("PetAccount", winAcc);
    const data = trophy.interface.encodeFunctionData("transferFrom", [winAcc, winner.address, 1n]);
    await expect(acc.connect(winner).execute(await trophy.getAddress(), 0n, data, 0)).to.be.revertedWithCustomError(
      trophy,
      "Soulbound",
    );
  });
});

describe("Arena: Skalierung", () => {
  it("Worst Case: 32 Teilnehmer, Reveal-Gas bleibt unter 2M", async () => {
    const f = await deployAll();
    const signers = (await ethers.getSigners()).slice(6, 38);
    const players = [];
    for (const s of signers) players.push({ who: s, petId: (await mintPet(f.pets, s)).id });
    const now = BigInt(await time.latest());
    await f.arena.createTournament(zone("u0qj8b"), now, now + 3600n, 0, commitOf(seedOf("big")), f.host.address);
    for (const p of players) {
      const sig = await signCheckIn(f.arena, f.checkin, p.who.address, p.petId, 1n, now + 600n);
      await f.arena.connect(p.who).join(1, p.petId, now + 600n, sig);
    }
    await time.increase(3601);
    await f.arena.close(1);
    await mine(1);
    const rc = await (await f.arena.reveal(1, seedOf("big"))).wait();
    console.log(`      reveal gas (32 entrants): ${rc!.gasUsed}`);
    expect(rc!.gasUsed).to.be.lt(2_000_000n);
  });
});

describe("Fusion 2 -> 1", () => {
  it("Kein XP-Exploit: Fusion vernichtet immer Wert (asymmetrisch Lv-hoch + Lv5)", async () => {
    const { pets, alice } = await loadFixture(fast);
    const a = await mintPet(pets, alice);
    const b = await mintPet(pets, alice);
    await interactN(pets, alice, a.id, 300);
    await interactN(pets, alice, b.id, 43);
    const ta = ref.totalXp((await pets.getPet(a.id)).level, (await pets.getPet(a.id)).xp);
    const tb = ref.totalXp((await pets.getPet(b.id)).level, (await pets.getPet(b.id)).xp);
    await pets.connect(alice).fuse(a.id, b.id);
    const k = await pets.getPet(a.id);
    const tk = ref.totalXp(k.level, k.xp);
    expect(tk).to.equal(ta + tb / 2n);
    expect(tk).to.be.lt(ta + tb);
  });

  it("Level < 5 oder fremdes Pet -> verboten", async () => {
    const { pets, alice, bob } = await loadFixture(fast);
    const a = await mintPet(pets, alice);
    const b = await mintPet(pets, alice);
    const c = await mintPet(pets, bob);
    await expect(pets.connect(alice).fuse(a.id, b.id)).to.be.revertedWithCustomError(pets, "FusionNotAllowed");
    await interactN(pets, alice, a.id, 43);
    await interactN(pets, bob, c.id, 43);
    await expect(pets.connect(alice).fuse(a.id, c.id)).to.be.revertedWithCustomError(pets, "NotPetOwner");
    await expect(pets.connect(alice).fuse(a.id, a.id)).to.be.revertedWithCustomError(pets, "FusionNotAllowed");
  });

  it("Stats/Level gemaess Formel, Burn, fusionCount/generation", async () => {
    const { pets, alice } = await loadFixture(fast);
    const a = await mintPet(pets, alice);
    const b = await mintPet(pets, alice);
    await interactN(pets, alice, a.id, 43, 0);
    await interactN(pets, alice, b.id, 80, 2);
    const pa = await pets.getPet(a.id);
    const pb = await pets.getPet(b.id);
    await pets.connect(alice).fuse(a.id, b.id);
    const pk = await pets.getPet(a.id);

    for (let i = 0; i < 4; i++) expect(pk.stats[i]).to.equal(ref.fuseStat(pa.stats[i], pb.stats[i], 0n));
    const [lvl, rem] = ref.levelFromXp(ref.totalXp(pa.level, pa.xp) + ref.totalXp(pb.level, pb.xp) / 2n);
    expect(pk.level).to.equal(lvl);
    expect(pk.xp).to.equal(rem);
    expect(lvl).to.be.gt(pa.level); // 80 + 21.5 Aktionen -> Level-Boost
    expect(pk.fusionCount).to.equal(1n);
    expect(pk.generation).to.equal(2n);
    expect(await pets.exists(b.id)).to.equal(false);
    await expect(pets.ownerOf(b.id)).to.be.revertedWithCustomError(pets, "ERC721NonexistentToken");
  });
});

describe("Marketplace", () => {
  async function listed() {
    const f = await deployAll();
    const a = await mintPet(f.pets, f.alice);
    await f.cosmetics.connect(f.alice).buy(1, 3, a.account, { value: ethers.parseEther("0.003") });
    await f.pets.connect(f.alice).approve(await f.market.getAddress(), a.id);
    await f.market.connect(f.alice).list(a.id, ethers.parseEther("1"));
    return { ...f, a };
  }

  it("Kauf: Pet + gesamtes TBA-Inventar wechseln zum Kaeufer, 2.5 % Fee", async () => {
    const { market, pets, cosmetics, alice, bob, deployer, a } = await loadFixture(listed);
    await market.connect(bob).buy(a.id, 0n, { value: ethers.parseEther("1") });
    expect(await pets.ownerOf(a.id)).to.equal(bob.address);
    const acc = await ethers.getContractAt("PetAccount", a.account);
    expect(await acc.owner()).to.equal(bob.address);
    expect(await cosmetics.balanceOf(a.account, 1)).to.equal(3n); // Inventar ist mitgewandert
    expect(await market.pending(alice.address)).to.equal(ethers.parseEther("0.975"));
    expect(await market.pending(deployer.address)).to.equal(ethers.parseEther("0.025"));
  });

  it("Drain-before-sale: Verkaeufer leert TBA nach Listing -> Kauf revertiert", async () => {
    const { market, cosmetics, alice, bob, a } = await loadFixture(listed);
    const acc = await ethers.getContractAt("PetAccount", a.account);
    const data = cosmetics.interface.encodeFunctionData("safeTransferFrom", [a.account, alice.address, 1n, 3n, "0x"]);
    await acc.connect(alice).execute(await cosmetics.getAddress(), 0n, data, 0);
    await expect(market.connect(bob).buy(a.id, 0n, { value: ethers.parseEther("1") })).to.be.revertedWithCustomError(
      market,
      "InventoryChanged",
    );
  });

  it("Re-Listing nach Drain: Kaeufer mit altem expectedState geschuetzt", async () => {
    const { market, cosmetics, alice, bob, a } = await loadFixture(listed);
    const acc = await ethers.getContractAt("PetAccount", a.account);
    const data = cosmetics.interface.encodeFunctionData("safeTransferFrom", [a.account, alice.address, 1n, 3n, "0x"]);
    await acc.connect(alice).execute(await cosmetics.getAddress(), 0n, data, 0);
    await market.connect(alice).list(a.id, ethers.parseEther("1"));
    await expect(market.connect(bob).buy(a.id, 0n, { value: ethers.parseEther("1") })).to.be.revertedWithCustomError(
      market,
      "InventoryChanged",
    );
  });
});
