/**
 * 999_smoke_tests — preuve d'isolation sous de VRAIS jetons.
 *
 * Trois comptes réels, trois sessions réelles, toutes les requêtes passent par
 * l'API HTTP avec le jeton de l'utilisateur : aucun `set_config`, aucun rôle
 * emprunté, aucune clé de service sur un chemin utilisateur.
 *
 * Exécution : bun test scripts/smoke/isolation.test.ts (ou vitest).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

const URL = process.env["SUPABASE_URL"]!;
const PUBLISHABLE = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
const SERVICE = process.env["SUPABASE_SERVICE_ROLE_KEY"]!;
const PASSWORD = "Smoke!12345";

const EMAILS = {
  pmeA: "pme-a@smoke.test",
  pmeB: "pme-b@smoke.test",
  cabinet: "cab@smoke.test",
} as const;

async function ensureUser(email: string) {
  await fetch(`${URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }),
  });
}

async function signIn(email: string) {
  const client = createClient(URL, PUBLISHABLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (error || !data.session) throw new Error(`sign-in ${email}: ${error?.message}`);
  return { client, userId: data.user!.id };
}

let A: { client: SupabaseClient; userId: string };
let B: { client: SupabaseClient; userId: string };
let C: { client: SupabaseClient; userId: string };
let orgA = "";
let orgB = "";
let orgC = "";
let engagement = "";
const stamp = Date.now();

/**
 * Cette preuve exige un vrai backend : trois comptes, trois sessions, des
 * jetons émis par le service d'authentification. Sans les variables qui le
 * désignent, elle s'ignore visiblement au lieu d'échouer.
 *
 * La distinction n'est pas cosmétique : une suite qui échoue toujours rend le
 * vert de la CI inutile, et personne ne regarde plus un tableau rouge par
 * habitude. Ignorée, elle dit ce qui lui manque ; en échec, elle ne dit rien.
 */
const BACKEND_CONFIGURE = Boolean(
  process.env["SUPABASE_URL"] &&
    process.env["SUPABASE_PUBLISHABLE_KEY"] &&
    process.env["SUPABASE_SERVICE_ROLE_KEY"],
);

beforeAll(async () => {
  if (!BACKEND_CONFIGURE) return;
  await Promise.all(Object.values(EMAILS).map(ensureUser));
  [A, B, C] = await Promise.all([
    signIn(EMAILS.pmeA),
    signIn(EMAILS.pmeB),
    signIn(EMAILS.cabinet),
  ]);

  // Chaque organisation est créée par son propre dirigeant, via l'API.
  const mk = async (
    s: { client: SupabaseClient },
    kind: string,
    name: string,
    mode: string,
  ) => {
    const { data, error } = await s.client.rpc("create_organization", {
      p_kind: kind,
      p_name: name,
      p_validation_mode: mode,
    });
    if (error) throw new Error(`${name}: ${error.message}`);
    return data as string;
  };
  orgA = await mk(A, "pme", `SMOKE PME A ${stamp}`, "mandate");
  orgB = await mk(B, "pme", `SMOKE PME B ${stamp}`, "autonome");
  orgC = await mk(C, "cabinet", `SMOKE CABINET ${stamp}`, "mandate");

  const eng = await A.client
    .from("engagements_v")
    .insert({ pme_org_id: orgA, cabinet_org_id: orgC, status: "actif", created_by: A.userId })
    .select("id")
    .single();
  if (eng.error) throw new Error(`engagement: ${eng.error.message}`);
  engagement = eng.data.id as string;

  const ent = await A.client
    .from("entities_v")
    .insert({ tenant_id: orgA, code: `SMOKE-${stamp}`, name: `SMOKE Etab ${stamp}` })
    .select("id")
    .single();
  if (ent.error) throw new Error(`entity: ${ent.error.message}`);

  const pieces = await A.client.from("pieces_v").insert([
    {
      tenant_id: orgA,
      entity_id: ent.data.id,
      vis: "partage",
      source: "pdf",
      storage_path: "smoke/a-partage.pdf",
      idempotency_key: `smoke-a-partage-${stamp}`,
    },
    {
      tenant_id: orgA,
      entity_id: ent.data.id,
      vis: "personnel",
      source: "photo",
      storage_path: "smoke/a-perso.jpg",
      idempotency_key: `smoke-a-perso-${stamp}`,
    },
  ]);
  if (pieces.error) throw new Error(`pieces A: ${pieces.error.message}`);

  const pieceB = await B.client.from("pieces_v").insert({
    tenant_id: orgB,
    vis: "partage",
    source: "pdf",
    storage_path: "smoke/b-partage.pdf",
    idempotency_key: `smoke-b-partage-${stamp}`,
  });
  if (pieceB.error) throw new Error(`piece B: ${pieceB.error.message}`);
}, 60_000);

describe.skipIf(!BACKEND_CONFIGURE)("isolation des tenants sous jetons réels", () => {
  it("A ne voit que son organisation", async () => {
    const { data } = await A.client
      .from("organizations_v")
      .select("id")
      .in("id", [orgA, orgB, orgC]);
    expect(data?.map((r) => r.id)).toEqual([orgA]);
  });

  it("A voit ses deux pièces", async () => {
    const { data } = await A.client.from("pieces_v").select("id,vis").eq("tenant_id", orgA);
    expect(data).toHaveLength(2);
  });

  it("B ne voit aucune ligne de A", async () => {
    const { data } = await B.client.from("pieces_v").select("id").eq("tenant_id", orgA);
    expect(data).toEqual([]);
  });

  it("B ne voit que sa pièce et son organisation", async () => {
    const pieces = await B.client.from("pieces_v").select("id").eq("tenant_id", orgB);
    const orgs = await B.client
      .from("organizations_v")
      .select("id")
      .in("id", [orgA, orgB, orgC]);
    expect(pieces.data).toHaveLength(1);
    expect(orgs.data?.map((r) => r.id)).toEqual([orgB]);
  });

  it("A ne peut pas écrire dans le tenant B", async () => {
    const { error } = await A.client.from("pieces_v").insert({
      tenant_id: orgB,
      vis: "partage",
      source: "pdf",
      storage_path: "x",
      idempotency_key: `smoke-intrusion-${stamp}`,
    });
    expect(error).not.toBeNull();
  });
});

describe.skipIf(!BACKEND_CONFIGURE)("mur personnel / partage", () => {
  it("le cabinet mandaté voit exactement la pièce partagée de A", async () => {
    const { data } = await C.client
      .from("pieces_v")
      .select("storage_path,vis")
      .eq("tenant_id", orgA);
    expect(data).toEqual([{ storage_path: "smoke/a-partage.pdf", vis: "partage" }]);
  });

  it("le cabinet ne voit rien du tenant B, non mandaté", async () => {
    const { data } = await C.client.from("pieces_v").select("id").eq("tenant_id", orgB);
    expect(data).toEqual([]);
  });

  it("le cabinet ne peut pas écrire dans le tenant A", async () => {
    const { error } = await C.client.from("pieces_v").insert({
      tenant_id: orgA,
      vis: "partage",
      source: "pdf",
      storage_path: "x",
      idempotency_key: `smoke-cabinet-${stamp}`,
    });
    expect(error).not.toBeNull();
  });

  it("mandat terminé : le cabinet ne voit plus rien de A", async () => {
    const { error } = await A.client.rpc("set_engagement_status", {
      p_engagement: engagement,
      p_status: "termine",
    });
    expect(error).toBeNull();
    const { data } = await C.client.from("pieces_v").select("id").eq("tenant_id", orgA);
    expect(data).toEqual([]);
  });
});

describe.skipIf(!BACKEND_CONFIGURE)("visiteur non connecté", () => {
  it("anon n'atteint ni les pièces ni les organisations", async () => {
    const anon = createClient(URL, PUBLISHABLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const pieces = await anon.from("pieces_v").select("id");
    const orgs = await anon.from("organizations_v").select("id");
    expect(pieces.error).not.toBeNull();
    expect(orgs.error).not.toBeNull();
  });
});
