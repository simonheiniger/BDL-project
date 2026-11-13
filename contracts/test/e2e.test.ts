import { expect } from "chai";
import { ethers } from "hardhat";
import { deployAll, mintPet, interactN, runTournament } from "./fixture";

/**
 * Komplettes Demo-Szenario wie in der Praesentation:
 * mint -> pflegen -> Cosmetics ins TBA -> Turniersieg (Trophy + Preisgeld) -> Fusion mit Inventar-Migration
 * -> Verkauf: Kaeufer erhaelt Pet inkl. aller Cosmetics, Trophaeen und ETH.
 */
describe("E2E: Lebenszyklus eines Pets", () => {
  it("Inventar folgt dem Pet durch Fusion und Verkauf", async () => {
    const { pets, cosmetics, trophy, arena, market, alice, bob, carol, host, checkin } = await deployAll();

    // 1) Alice mintet zwei Pets und levelt beide auf >= 5
    const keep = await mintPet(pets, alice);
    const burn = await mintPet(pets, alice);
    await interactN(pets, alice, keep.id, 43, 0);
    await interactN(pets, alice, burn.id, 43, 1);

    // 2) Cosmetics: Zylinder ins TBA von "burn", Sonnenbrille ins TBA von "keep"
    await cosmetics.connect(alice).buy(1, 2, burn.account, { value: ethers.parseEther("0.002") });
    await cosmetics.connect(alice).buy(2, 1, keep.account, { value: ethers.parseEther("0.002") });

    // 3) Turniere bis "burn" gewinnt (Zufall!) – Trophy + Preisgeld landen im TBA von "burn"
    const rival = await mintPet(pets, bob);
    let wins = 0;
    for (let i = 0; i < 20 && wins === 0; i++) {
      const { settled } = await runTournament(
        arena,
        checkin,
        host,
        [
          { who: alice, petId: burn.id },
          { who: bob, petId: rival.id },
        ],
        ethers.parseEther("0.01"),
        `seed-${i}`,
      );
      if (settled!.winnerPet === burn.id) wins++;
    }
    expect(wins).to.equal(1);
    expect(await trophy.balanceOf(burn.account)).to.equal(1n);
    const burnEth = await ethers.provider.getBalance(burn.account);
    expect(burnEth).to.equal(ethers.parseEther("0.014"));

    // 4) Fusion: burn -> keep. Alles aus burn.account wandert nach keep.account
    await pets.connect(alice).fuse(keep.id, burn.id);
    expect(await pets.exists(burn.id)).to.equal(false);
    expect(await cosmetics.balanceOf(keep.account, 1)).to.equal(2n);
    expect(await cosmetics.balanceOf(keep.account, 2)).to.equal(1n);
    expect(await cosmetics.balanceOf(burn.account, 1)).to.equal(0n);
    expect(await trophy.balanceOf(keep.account)).to.equal(1n);
    expect(await trophy.balanceOf(burn.account)).to.equal(0n);
    expect(await ethers.provider.getBalance(keep.account)).to.equal(burnEth);
    // XP' = 860 + 860/2 = 1290 -> Level 5 (Lv6 braucht 1409) mit 440 XP Rest
    expect((await pets.getPet(keep.id)).level).to.equal(5n);
    expect((await pets.getPet(keep.id)).xp).to.equal(440n);

    // 5) Verkauf an Carol: sie kontrolliert danach Pet + TBA + ganzes Inventar
    await pets.connect(alice).approve(await market.getAddress(), keep.id);
    await market.connect(alice).list(keep.id, ethers.parseEther("2"));
    const acc = await ethers.getContractAt("PetAccount", keep.account);
    const seenState = await acc.state();
    await market.connect(carol).buy(keep.id, seenState, { value: ethers.parseEther("2") });

    expect(await pets.ownerOf(keep.id)).to.equal(carol.address);
    expect(await acc.owner()).to.equal(carol.address);
    await expect(acc.connect(carol).execute(carol.address, burnEth, "0x", 0)).to.changeEtherBalance(carol, burnEth);
  });
});
