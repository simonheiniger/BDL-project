import { ethers, network } from "hardhat";

/**
 * TEST-ETH an Mitspieler verteilen (vom Account in contracts/.env).
 *
 *   TO=0xabc...,0xdef... AMOUNT=2 npx hardhat run scripts/send-eth.ts --network bdl
 */
async function main() {
  const to = (process.env.TO ?? "").split(",").map((a) => a.trim()).filter(Boolean);
  const amount = ethers.parseEther(process.env.AMOUNT ?? "1");
  if (to.length === 0) throw new Error("TO=0x...[,0x...] fehlt");
  const [me] = await ethers.getSigners();
  console.log(`Netz ${network.name}, von ${me.address} (${ethers.formatEther(await ethers.provider.getBalance(me.address))} ETH)`);
  for (const addr of to) {
    if (!ethers.isAddress(addr)) {
      console.log(`  ✗ ${addr}: keine gueltige Adresse`);
      continue;
    }
    const rc = await (await me.sendTransaction({ to: addr, value: amount })).wait();
    console.log(`  ✓ ${ethers.formatEther(amount)} ETH -> ${addr} (tx ${rc!.hash.slice(0, 10)}…)`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
