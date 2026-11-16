import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount, useBlockNumber, useChainId, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { BaseError, type Abi, type Address, type PublicClient } from "viem";
import { useContracts, accountAbi, type Contracts, type Pet } from "./contracts";

/**
 * Lese-Query, die bei jedem neuen Block neu laedt (Blocknummer im Query-Key).
 * Bewusst ohne Multicall: der Hardhat-Node hat keinen Multicall3-Contract.
 */
export function useChainQuery<T>(key: unknown[], fn: (pc: PublicClient, c: Contracts) => Promise<T>, enabled = true) {
  const pc = usePublicClient();
  const c = useContracts();
  const chainId = useChainId();
  const { data: block } = useBlockNumber({ watch: true });
  return useQuery({
    queryKey: [chainId, ...key, block?.toString()],
    queryFn: () => fn(pc!, c!),
    enabled: enabled && !!pc && !!c,
    placeholderData: (prev) => prev,
  });
}

const read = <T>(pc: PublicClient, address: Address, abi: Abi, functionName: string, args: unknown[] = []) =>
  pc.readContract({ address, abi, functionName, args }) as Promise<T>;

/** Eigene Pets ueber Transfer-Events finden (PetNFT ist bewusst nicht ERC721Enumerable -> billigere Transfers) */
export function useMyPets() {
  const { address } = useAccount();
  return useChainQuery(
    ["myPets", address],
    async (pc, c) => {
      const logs = await pc.getContractEvents({
        address: c.PetNFT.address,
        abi: c.PetNFT.abi,
        eventName: "Transfer",
        args: { to: address },
        fromBlock: 0n,
      });
      const ids = [...new Set(logs.map((l) => (l as unknown as { args: { tokenId: bigint } }).args.tokenId))];
      const owned: bigint[] = [];
      for (const id of ids) {
        const owner = await read<Address>(pc, c.PetNFT.address, c.PetNFT.abi, "ownerOf", [id]).catch(() => null);
        if (owner?.toLowerCase() === address!.toLowerCase()) owned.push(id);
      }
      return owned.sort((a, b) => Number(a - b));
    },
    !!address,
  );
}

export type PetView = {
  id: bigint;
  owner: Address;
  account: Address;
  pet: Pet;
  name: string;
  image: string;
  /** on-chain Metadaten (PetRenderer), z.B. attrs.Seltenheit, attrs.Stufe */
  attrs: Record<string, string | number>;
};

export async function loadPet(pc: PublicClient, c: Contracts, id: bigint): Promise<PetView | null> {
  const owner = await read<Address>(pc, c.PetNFT.address, c.PetNFT.abi, "ownerOf", [id]).catch(() => null);
  if (!owner) return null;
  const [pet, account, uri] = await Promise.all([
    read<Pet>(pc, c.PetNFT.address, c.PetNFT.abi, "getPet", [id]),
    read<Address>(pc, c.PetNFT.address, c.PetNFT.abi, "accountOf", [id]),
    read<string>(pc, c.PetNFT.address, c.PetNFT.abi, "tokenURI", [id]),
  ]);
  const json = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(uri.split(",")[1]), (c) => c.charCodeAt(0))));
  const attrs = Object.fromEntries(
    (json.attributes as { trait_type: string; value: string | number }[]).map((a) => [a.trait_type, a.value]),
  );
  return { id, owner, account, pet, name: json.name, image: json.image, attrs };
}

export function usePet(id: bigint | undefined) {
  return useChainQuery(["pet", id?.toString()], (pc, c) => loadPet(pc, c, id!), id !== undefined);
}

export type Item = { id: number; name: string; price: bigint; maxSupply: bigint; minted: bigint };

export function useShopItems() {
  return useChainQuery(["items"], async (pc, c) => {
    const n = Number(await read<bigint>(pc, c.Cosmetics.address, c.Cosmetics.abi, "itemCount"));
    const items: Item[] = [];
    for (let i = 1; i <= n; i++) {
      const [name, price, maxSupply, minted] = await read<[string, bigint, bigint, bigint]>(
        pc,
        c.Cosmetics.address,
        c.Cosmetics.abi,
        "items",
        [BigInt(i)],
      );
      items.push({ id: i, name, price, maxSupply, minted });
    }
    return items;
  });
}

export type Inventory = {
  eth: bigint;
  state: bigint;
  cosmetics: { item: Item; amount: bigint }[];
  trophies: { id: bigint; tournamentId: bigint; zone: string; entrants: number; timestamp: bigint }[];
};

/** Alles, was die Pet-Wallet (TBA) besitzt */
export async function loadInventory(pc: PublicClient, c: Contracts, account: Address, items: Item[]): Promise<Inventory> {
  const [eth, state] = await Promise.all([
    pc.getBalance({ address: account }),
    read<bigint>(pc, account, accountAbi, "state"),
  ]);
  const cosmetics = [];
  for (const item of items) {
    const amount = await read<bigint>(pc, c.Cosmetics.address, c.Cosmetics.abi, "balanceOf", [account, BigInt(item.id)]);
    if (amount > 0n) cosmetics.push({ item, amount });
  }
  const nTrophies = await read<bigint>(pc, c.Trophy.address, c.Trophy.abi, "balanceOf", [account]);
  const trophies = [];
  for (let i = 0n; i < nTrophies; i++) {
    const id = await read<bigint>(pc, c.Trophy.address, c.Trophy.abi, "tokenOfOwnerByIndex", [account, i]);
    const [tournamentId, zone, timestamp, entrants] = await read<[bigint, string, bigint, number]>(
      pc,
      c.Trophy.address,
      c.Trophy.abi,
      "info",
      [id],
    );
    trophies.push({ id, tournamentId, zone, timestamp, entrants: Number(entrants) });
  }
  return { eth, state, cosmetics, trophies };
}

export function useInventory(account: Address | undefined) {
  const { data: items } = useShopItems();
  return useChainQuery(
    ["inv", account],
    (pc, c) => loadInventory(pc, c, account!, items!),
    !!account && !!items,
  );
}

/** Bekannte Wallet-Probleme in verstaendliche Anleitungen uebersetzen */
function friendlyError(e: unknown): string {
  const raw = e instanceof BaseError ? `${e.shortMessage} ${e.details ?? ""}` : (e as Error).message;
  if (/nonce too high/i.test(raw)) {
    return (
      "MetaMask kennt alte Transaktionen dieses Accounts, die das Testnetz (nach einem Neustart) nicht mehr hat. " +
      "Lösung: MetaMask → Einstellungen → Erweitert → „Aktivitäts-Tab-Daten löschen“, dann nochmal versuchen."
    );
  }
  if (/insufficient funds/i.test(raw)) return "Zu wenig TEST-ETH auf diesem Account.";
  if (/user rejected|denied/i.test(raw)) return "In MetaMask abgebrochen.";
  return e instanceof BaseError ? e.shortMessage : (e as Error).message;
}

/** Transaktion senden + auf Receipt warten + UI-Status (pending/Fehler) */
export function useTx() {
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();
  const { chainId: walletChain } = useAccount();
  const appChain = useChainId();
  const pc = usePublicClient();
  const qc = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Eigener Request-Typ: ABIs kommen als JSON, viem kann "payable" darum nicht statisch ableiten
  type Req = { address: Address; abi: Abi; functionName: string; args?: readonly unknown[]; value?: bigint };
  async function send(label: string, req: Req) {
    setError(null);
    setPending(label);
    try {
      // Sicherheit: Wallet muss auf derselben Chain sein, von der die App liest.
      // Sonst wuerde die Tx z.B. im Ethereum-Mainnet landen (echtes Geld, Contract existiert dort nicht).
      if (walletChain !== appChain) {
        setPending("Netzwerk in der Wallet wechseln");
        await switchChainAsync({ chainId: appChain });
        setPending(label);
      }
      const hash = await writeContractAsync({ ...req, chainId: appChain } as Parameters<typeof writeContractAsync>[0]);
      const rc = await pc!.waitForTransactionReceipt({ hash });
      if (rc.status !== "success") throw new Error("Transaktion revertiert");
      await qc.invalidateQueries();
      return rc;
    } catch (e) {
      setError(friendlyError(e));
      return null;
    } finally {
      setPending(null);
    }
  }
  return { send, pending, error, setError };
}
