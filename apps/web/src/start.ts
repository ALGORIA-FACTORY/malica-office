import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// Plus aucune fonction serveur ici : ce qui faisait parler un modèle vit dans
// l'API, sous `/regalica`. L'intergiciel CSRF que Start réservait aux fonctions
// serveur n'a donc plus rien à protéger, et ne figure plus.
export const startInstance = createStart(() => ({
  requestMiddleware: [errorMiddleware],
}));
