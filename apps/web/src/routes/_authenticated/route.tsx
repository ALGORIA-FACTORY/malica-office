import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { office } from "@/verticals/regalica-office/composition";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    // `session()` ne touche pas la base : elle ne fait que lire le jeton. Cette
    // garde s'exécute à chaque navigation, elle doit rester gratuite.
    const compte = await office().auth.session();
    if (!compte) throw redirect({ to: "/auth" });
    return { user: compte };
  },
  component: () => <Outlet />,
});
