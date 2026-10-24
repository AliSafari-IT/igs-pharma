import AsyncStorage from "@react-native-async-storage/async-storage";
import { type ReactNode, createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ListItem } from "../api/types";
import { useSettings } from "../settings/SettingsContext";
import {
  type SavedProduct,
  addSaved,
  parseSaved,
  refreshSaved,
  removeSaved,
  toSaved,
} from "./list";

const STORAGE_KEY = "igs.list.v1";

interface ListValue {
  saved: readonly SavedProduct[];
  has: (cnk: string) => boolean;
  add: (item: ListItem) => void;
  /** Keeps the saved price and stock current when a saved product is viewed. */
  refresh: (item: ListItem) => void;
  remove: (cnk: string) => void;
  clear: () => void;
}

const ListContext = createContext<ListValue | null>(null);

export function ListProvider({ children }: { children: ReactNode }) {
  const { locale } = useSettings();
  const [saved, setSaved] = useState<readonly SavedProduct[]>([]);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      // a product saved in the first moment, before the read finished, is not thrown away
      .then((raw) => setSaved((current) => (current.length > 0 ? current : parseSaved(raw))))
      .catch(() => {});
  }, []);

  // the actions never change with the list itself, so a screen can depend on them in an effect
  const actions = useMemo(() => {
    const change = (next: (list: readonly SavedProduct[]) => SavedProduct[]) =>
      setSaved((current) => {
        const list = next(current);
        AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(list)).catch(() => {});
        return list;
      });
    return {
      add: (item: ListItem) => change((list) => addSaved(list, toSaved(item, locale, new Date()))),
      refresh: (item: ListItem) =>
        change((list) => refreshSaved(list, toSaved(item, locale, new Date()))),
      remove: (cnk: string) => change((list) => removeSaved(list, cnk)),
      clear: () => change(() => []),
    };
  }, [locale]);

  const value = useMemo<ListValue>(
    () => ({ ...actions, saved, has: (cnk) => saved.some((entry) => entry.cnk === cnk) }),
    [actions, saved],
  );

  return <ListContext.Provider value={value}>{children}</ListContext.Provider>;
}

export function useList(): ListValue {
  const value = useContext(ListContext);
  if (!value) throw new Error("useList must be used inside ListProvider");
  return value;
}
