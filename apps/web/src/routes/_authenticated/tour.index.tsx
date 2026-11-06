/** La tour s'ouvre sur ses clients : la liste des cabinets. */
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/tour/")({
  beforeLoad: () => {
    throw redirect({ to: "/tour/cabinets", replace: true });
  },
});
