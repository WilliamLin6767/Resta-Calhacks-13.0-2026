// Which running calls a calls panel on this page is already checking on, so CallDriver doesn't
// ask for their status a second time.
const followed = new Map<number, number>(); // call id -> panels following it

export function followCalls(ids: number[]): () => void {
  for (const id of ids) followed.set(id, (followed.get(id) ?? 0) + 1);
  return () => {
    for (const id of ids) {
      const n = (followed.get(id) ?? 1) - 1;
      if (n > 0) followed.set(id, n);
      else followed.delete(id);
    }
  };
}

export function isFollowed(id: number): boolean {
  return followed.has(id);
}
