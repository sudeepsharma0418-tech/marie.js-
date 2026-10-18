import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from './auth';

export interface CartLine {
  productId: string;
  quantity: string;
  nameEn: string;
  nameNe: string;
  unit: string;
  unitPrice: string | null;
  minOrderQty: string;
}

interface CartState {
  lines: CartLine[];
  set: (line: CartLine) => void;
  remove: (productId: string) => void;
  clear: () => void;
}

const Ctx = createContext<CartState | null>(null);

/** Cart is a per-user draft kept in the browser until the order is submitted. Prices are re-checked by the server. */
export function CartProvider({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const key = me ? `hp.cart.${me.user.id}` : null;
  const [lines, setLines] = useState<CartLine[]>([]);
  useEffect(() => {
    if (!key) return setLines([]);
    try {
      setLines(JSON.parse(localStorage.getItem(key) ?? '[]'));
    } catch {
      setLines([]);
    }
  }, [key]);
  useEffect(() => {
    if (key) localStorage.setItem(key, JSON.stringify(lines));
  }, [key, lines]);
  const value = useMemo<CartState>(
    () => ({
      lines,
      set: (line) =>
        setLines((cur) => {
          const rest = cur.filter((l) => l.productId !== line.productId);
          return Number(line.quantity) > 0 ? [...rest, line] : rest;
        }),
      remove: (id) => setLines((cur) => cur.filter((l) => l.productId !== id)),
      clear: () => setLines([]),
    }),
    [lines],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCart() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useCart outside CartProvider');
  return v;
}
