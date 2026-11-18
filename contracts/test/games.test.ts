import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployAll, mintPet, signVoucher } from "./fixture";

async function setup() {
  const f = await deployAll();
  const pet = await mintPet(f.pets, f.alice);
  return { ...f, pet };
}

const voucher = async (f: Awaited<ReturnType<typeof setup>>, o: Partial<{ player: string; petId: bigint; kind: number; xp: number; nonce: bigint; expiry: bigint }> = {}) => {
  const v = {
    player: f.alice.address,
    petId: f.pet.id,
    kind: 0,
    xp: 30,
    nonce: BigInt(ethers.hexlify(ethers.randomBytes(32))),
    expiry: BigInt(await time.latest()) + 3600n,
    ...o,
  };
  return { v, sig: await signVoucher(f.games, f.gamer, v) };
};

describe("PetGames: XP aus Minispielen per Gutschein", () => {
  it("Gutschein einloesen gibt XP (ohne Haus-Scan)", async () => {
    const f = await loadFixture(setup);
    const { v, sig } = await voucher(f, { xp: 40 });
    await f.games.connect(f.alice).claim([v], [sig]);
    const p = await f.pets.getPet(f.pet.id);
    expect(p.level).to.equal(1n); // Lv 2 braucht 50 XP
    expect(p.xp).to.equal(40n);
  });

  it("Mehrere Gutscheine mit einer Transaktion -> Level-Up", async () => {
    const f = await loadFixture(setup);
    const vs = [];
    const sigs = [];
    for (let i = 0; i < 4; i++) {
      const { v, sig } = await voucher(f, { xp: 35, kind: i % 3 });
      vs.push(v);
      sigs.push(sig);
    }
    await expect(f.games.connect(f.alice).claim(vs, sigs)).to.emit(f.games, "Claimed");
    const p = await f.pets.getPet(f.pet.id);
    // 140 XP: Lv 2 ab 50 XP, Lv 3 erst ab 50 + 141 = 191 XP -> Lv 2 mit 90 XP Rest
    expect(p.level).to.equal(2n);
    expect(p.xp).to.equal(90n);
  });

  it("Gutschein nur einmal einloesbar", async () => {
    const f = await loadFixture(setup);
    const { v, sig } = await voucher(f);
    await f.games.connect(f.alice).claim([v], [sig]);
    await expect(f.games.connect(f.alice).claim([v], [sig])).to.be.revertedWithCustomError(f.games, "AlreadyUsed");
  });

  it("Tageslimit 200 XP pro Pet: Rest wird gekappt, naechster Tag wieder frei", async () => {
    const f = await loadFixture(setup);
    const vs = [];
    const sigs = [];
    for (let i = 0; i < 6; i++) {
      const { v, sig } = await voucher(f, { xp: 40 });
      vs.push(v);
      sigs.push(sig);
    }
    await f.games.connect(f.alice).claim(vs, sigs); // 240 angefragt
    expect(await f.games.xpToday(f.pet.id)).to.equal(200n);
    await time.increase(86400);
    const { v, sig } = await voucher(f, { xp: 40 });
    await f.games.connect(f.alice).claim([v], [sig]);
    expect(await f.games.xpToday(f.pet.id)).to.equal(40n);
  });

  it("Falscher Signer, fremder Spieler, abgelaufen, zu viel XP -> abgelehnt", async () => {
    const f = await loadFixture(setup);
    const good = await voucher(f);
    const forged = await signVoucher(f.games, f.bob, good.v);
    await expect(f.games.connect(f.alice).claim([good.v], [forged])).to.be.revertedWithCustomError(f.games, "BadSignature");
    await expect(f.games.connect(f.bob).claim([good.v], [good.sig])).to.be.revertedWithCustomError(f.games, "NotPlayer");
    const old = await voucher(f, { expiry: BigInt(await time.latest()) - 1n });
    await expect(f.games.connect(f.alice).claim([old.v], [old.sig])).to.be.revertedWithCustomError(f.games, "Expired");
    const big = await voucher(f, { xp: 41 });
    await expect(f.games.connect(f.alice).claim([big.v], [big.sig])).to.be.revertedWithCustomError(f.games, "TooMuchXp");
  });

  it("Pet verkauft -> alter Gutschein des Vorbesitzers ungueltig", async () => {
    const f = await loadFixture(setup);
    const { v, sig } = await voucher(f);
    await f.pets.connect(f.alice).transferFrom(f.alice.address, f.bob.address, f.pet.id);
    await expect(f.games.connect(f.alice).claim([v], [sig])).to.be.revertedWithCustomError(f.games, "NotPetOwner");
  });

  it("gameXp nur durch PetGames; Rennen zahlt auf AGI-Fokus ein", async () => {
    const f = await loadFixture(setup);
    await expect(f.pets.connect(f.alice).gameXp(f.pet.id, 10, 1)).to.be.revertedWithCustomError(f.pets, "NotGames");
    const { v, sig } = await voucher(f, { kind: 2, xp: 10 });
    await f.games.connect(f.alice).claim([v], [sig]);
    expect((await f.pets.getPet(f.pet.id)).focus[1]).to.equal(1n);
  });
});
