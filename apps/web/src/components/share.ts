// «Compartir» y «Copiar código» del lobby (decisión de diseño): la hoja de compartir del
// sistema con el enlace `…/#/sala/CODIGO` (nunca con la ficha); sin hoja, se copia el enlace; sin
// portapapeles (por ejemplo, en HTTP dentro de la red local), un diálogo con el texto seleccionado.

/** Lo que se usa del navegador; las pruebas lo reemplazan. */
export interface ShareApi {
  readonly share?: ((data: ShareData) => Promise<void>) | undefined;
  readonly writeText?: ((text: string) => Promise<void>) | undefined;
}

export function browserShareApi(): ShareApi {
  if (typeof navigator === "undefined") return {};
  const nav: Partial<Navigator> = navigator;
  const { clipboard } = nav;
  return {
    share: typeof nav.share === "function" ? (data) => navigator.share(data) : undefined,
    // Sin contexto seguro (HTTP en la red local) no hay portapapeles.
    writeText:
      typeof clipboard?.writeText === "function" ? (text) => clipboard.writeText(text) : undefined,
  };
}

/** `manual`: no hubo forma de copiar; hay que mostrar el texto para copiarlo a mano. */
export type CopyResult = "copied" | "manual";
export type ShareResult = "shared" | "cancelled" | CopyResult;

export async function copyText(api: ShareApi, text: string): Promise<CopyResult> {
  if (!api.writeText) return "manual";
  try {
    await api.writeText(text);
    return "copied";
  } catch {
    return "manual";
  }
}

export async function shareLink(
  api: ShareApi,
  data: { readonly url: string; readonly title: string; readonly text: string },
): Promise<ShareResult> {
  if (api.share) {
    try {
      await api.share({ url: data.url, title: data.title, text: data.text });
      return "shared";
    } catch (error) {
      // Quien cierra la hoja no quiere compartir: no se copia nada.
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
    }
  }
  return copyText(api, data.url);
}
