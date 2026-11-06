export type Role = 'owner' | 'oversee' | 'staff' | 'onlooker';

export const ROLE_LABEL: Record<Role, string> = {
  owner: 'Team Leader',
  oversee: 'Oversee',
  staff: 'Staff',
  onlooker: 'Onlooker',
};

export const ROLE_INFO: Record<Exclude<Role, 'owner'>, string> = {
  oversee: 'Sees who is online, adjusts stock, stock in/out, manages products',
  staff: 'Stock in / out only (transfer if allowed)',
  onlooker: 'Can only look at stock, no changes',
};

const is = (role: Role | null | undefined, ...roles: Role[]) => !!role && roles.includes(role);

export const can = {
  moveStock: (r?: Role | null) => is(r, 'owner', 'oversee', 'staff'),
  /** Staff may transfer only when the Owner allowed it for their account. */
  transfer: (r?: Role | null, staffAllowed = false) => is(r, 'owner', 'oversee') || (r === 'staff' && staffAllowed),
  adjustStock: (r?: Role | null) => is(r, 'owner', 'oversee'),
  manageProducts: (r?: Role | null) => is(r, 'owner', 'oversee'),
  manageLocations: (r?: Role | null) => is(r, 'owner', 'oversee'),
  seeTeam: (r?: Role | null) => is(r, 'owner', 'oversee'),
  manageUsers: (r?: Role | null) => is(r, 'owner'),
};
