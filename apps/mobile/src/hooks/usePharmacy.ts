import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { Pharmacy } from "../api/types";

const STORED_AS = "igs.pharmacy.v1";

/**
 * The pharmacy's public details: the last copy on the phone at once, then a fresh one from the
 * storefront when it answers. `null` until the app has ever reached the storefront; the screens then
 * show the on-duty and emergency numbers and the website, which need no data.
 */
export function usePharmacy(): Pharmacy | null {
  const [pharmacy, setPharmacy] = useState<Pharmacy | null>(null);
  useEffect(() => {
    let current = true;
    AsyncStorage.getItem(STORED_AS)
      .then((raw) => {
        if (!current || !raw) return;
        let stored: Pharmacy;
        try {
          stored = JSON.parse(raw) as Pharmacy;
        } catch {
          return; // a broken copy is ignored; the next answer from the storefront replaces it
        }
        setPharmacy((fresh) => fresh ?? stored);
      })
      .catch(() => {});
    api.pharmacy().then(
      (fresh) => {
        if (!current) return;
        setPharmacy(fresh);
        AsyncStorage.setItem(STORED_AS, JSON.stringify(fresh)).catch(() => {});
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
