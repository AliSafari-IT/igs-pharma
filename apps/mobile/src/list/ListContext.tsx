import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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

const STORED_AS = "igs.list.v1";

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

  // false until the stored list is read; a change made before that wins over the stored copy
  const [hydrated, setHydrated] = useState(false);
  const changedEarly = useRef(false);
  const writing = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    AsyncStorage.getItem(STORED_AS)
      .then((raw) => {
        if (!changedEarly.current) setSaved(parseSaved(raw));
      })
      .catch(() => {})
      .finally(() => setHydrated(true));
  }, []);

  // writes run one after the other, so an older list never lands after a newer one
  useEffect(() => {
    if (!hydrated) return;
    const json = JSON.stringify(saved);
    writing.current = writing.current
      .then(() => AsyncStorage.setItem(STORED_AS, json))
      .catch(() => {});
  }, [hydrated, saved]);

  // the actions never change with the list itself, so a screen can depend on them in an effect
  const actions = useMemo(() => {
    const change = (next: (list: readonly SavedProduct[]) => SavedProduct[]) => {
      changedEarly.current = true;
      setSaved(next);
    };
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
