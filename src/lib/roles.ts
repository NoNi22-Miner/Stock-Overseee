export type Role = 'owner' | 'oversee' | 'staff' | 'onlooker';

/** Staff accounts sign in with a User ID; Auth stores it as <userid>@LOGIN_DOMAIN. */
export const LOGIN_DOMAIN = 'users.stock-overseee.invalid';

export function userIdToEmail(userId: string) {
  return `${userId.trim().toLowerCase()}@${LOGIN_DOMAIN}`;
}

export const ROLE_LABEL: Record<Role, string> = {
  owner: 'Owner',
  oversee: 'Oversee',
  staff: 'Staff',
  onlooker: 'Onlooker',
};

export const ROLE_INFO: Record<Exclude<Role, 'owner'>, string> = {
  oversee: 'Sees who is online, adjusts stock, stock in/out, manages products',
  staff: 'Stock in / out / transfer only',
  onlooker: 'Can only look at stock, no changes',
};

const is = (role: Role | null | undefined, ...roles: Role[]) => !!role && roles.includes(role);

export const can = {
  moveStock: (r?: Role | null) => is(r, 'owner', 'oversee', 'staff'),
  adjustStock: (r?: Role | null) => is(r, 'owner', 'oversee'),
  manageProducts: (r?: Role | null) => is(r, 'owner', 'oversee'),
  manageLocations: (r?: Role | null) => is(r, 'owner', 'oversee'),
  seeTeam: (r?: Role | null) => is(r, 'owner', 'oversee'),
  manageUsers: (r?: Role | null) => is(r, 'owner'),
};
