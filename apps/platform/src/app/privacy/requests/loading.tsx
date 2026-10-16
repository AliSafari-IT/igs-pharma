import { ListPageSkeleton } from "../../../components/list-page-skeleton";

/** The loading state of the Data requests page (igs-pharma#104). */
export default function Loading() {
  return <ListPageSkeleton title="Data requests" search />;
}
