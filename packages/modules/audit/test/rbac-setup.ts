// T-016: hasPermission needs an installed catalogue; tests use the code catalogue (no DB load).
import { useCodeRbacCatalogue } from "@igs/kernel/testing";

useCodeRbacCatalogue();
