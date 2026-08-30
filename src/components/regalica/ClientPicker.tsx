import type { ClientSummary } from "@/verticals/regalica-office/ports/repositories";

/**
 * Sélecteur de client pour les écrans cabinet.
 * Le mur de visibilité reste tenu par la base : cette liste ne contient
 * que les mandats actifs renvoyés par le dépôt.
 */
export function ClientPicker({
  label,
  clients,
  value,
  onChange,
}: {
  label: string;
  clients: readonly ClientSummary[];
  value: string | null;
  onChange: (tenantId: string) => void;
}) {
  return (
    <label className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wide">
      <span className="text-muted-foreground">{label}</span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="border border-border bg-card px-3 py-2 text-[13px] font-normal normal-case tracking-normal"
      >
        {clients.map((c) => (
          <option key={c.tenantId} value={c.tenantId}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
  );
}
