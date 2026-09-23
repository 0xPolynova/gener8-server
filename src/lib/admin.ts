export const ADMIN_WALLETS = [
  "o8DeJVt4sv9z6Tcid7VtLGK89g95HymRv5DB4vVDS7u",
  "5KmSeQBxpMHGYnvBBcN5LRqEJJABAJAko3mD24RM56d3",
] as const;

export function isAdminWallet(address: string | null | undefined) {
  if (!address) return false;
  return (ADMIN_WALLETS as readonly string[]).includes(address);
}
