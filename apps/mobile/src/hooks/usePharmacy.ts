import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { Pharmacy } from "../api/types";

const STORAGE_KEY = "igs.pharmacy.v1";

/**
 * The pharmacy's public details: the last copy on the phone at once, then a fresh one from the
 * storefront when it answers. `null` until the app has ever reached the storefront; the screens then
 * show the on-duty and emergency numbers and the website, which need no data.
 */
export function usePharmacy(): Pharmacy | null {
  const [pharmacy, setPharmacy] = useState<Pharmacy | null>(null);
  useEffect(() => {
    let current = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (current && raw) setPharmacy((fresh) => fresh ?? (JSON.parse(raw) as Pharmacy));
      })
      .catch(() => {});
    api.pharmacy().then(
      (fresh) => {
        if (!current) return;
        setPharmacy(fresh);
        AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(fresh)).catch(() => {});
      },
      () => {
        // closed or offline: keep the copy on the phone
      },
    );
    return () => {
      current = false;
    };
  }, []);
  return pharmacy;
}
