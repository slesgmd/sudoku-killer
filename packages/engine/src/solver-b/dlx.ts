/**
 * Dancing Links (algoritmo X de Knuth) sobre arreglos tipados. El nodo 0 es la raíz, los nodos
 * 1..itemCount son las cabeceras de los ítems y el resto son las entradas de las opciones, en
 * listas circulares dobles: horizontal dentro de cada opción y vertical dentro de cada ítem.
 */
export interface Links {
  readonly left: Int32Array;
  readonly right: Int32Array;
  readonly up: Int32Array;
  readonly down: Int32Array;
  /** Cabecera del ítem de cada nodo. */
  readonly top: Int32Array;
  /** Opción de cada nodo (−1 en la raíz y las cabeceras). */
  readonly option: Int32Array;
  /** Opciones que quedan en cada ítem, indexado por cabecera. */
  readonly length: Int32Array;
}

export function buildLinks(itemCount: number, options: readonly (readonly number[])[]): Links {
  let nodeCount = itemCount + 1;
  for (const items of options) nodeCount += items.length;
  const links: Links = {
    left: new Int32Array(nodeCount),
    right: new Int32Array(nodeCount),
    up: new Int32Array(nodeCount),
    down: new Int32Array(nodeCount),
    top: new Int32Array(nodeCount),
    option: new Int32Array(nodeCount).fill(-1),
    length: new Int32Array(itemCount + 1),
  };
  const { left, right, up, down, top, option, length } = links;

  for (let header = 0; header <= itemCount; header++) {
    left[header] = header === 0 ? itemCount : header - 1;
    right[header] = header === itemCount ? 0 : header + 1;
    up[header] = header;
    down[header] = header;
    top[header] = header;
  }

  let node = itemCount + 1;
  options.forEach((items, index) => {
    const first = node;
    for (const item of items) {
      const header = item + 1;
      top[node] = header;
      option[node] = index;
      up[node] = up[header]!;
      down[node] = header;
      down[up[header]!] = node;
      up[header] = node;
      length[header]!++;
      left[node] = node === first ? first + items.length - 1 : node - 1;
      right[node] = node === first + items.length - 1 ? first : node + 1;
      node++;
    }
  });
  return links;
}

/** Quita el ítem de la cabecera y todas las opciones que lo usan de los demás ítems. */
export function cover(links: Links, header: number): void {
  const { left, right, up, down, top, length } = links;
  right[left[header]!] = right[header]!;
  left[right[header]!] = left[header]!;
  for (let row = down[header]!; row !== header; row = down[row]!) {
    for (let node = right[row]!; node !== row; node = right[node]!) {
      down[up[node]!] = down[node]!;
      up[down[node]!] = up[node]!;
      length[top[node]!]!--;
    }
  }
}

/** Quita una opción (dada por cualquiera de sus nodos) de las listas de todos sus ítems. */
export function hide(links: Links, row: number): void {
  const { right, up, down, top, length } = links;
  let node = row;
  do {
    down[up[node]!] = down[node]!;
    up[down[node]!] = up[node]!;
    length[top[node]!]!--;
    node = right[node]!;
  } while (node !== row);
}

/** Deshace `hide` en el orden inverso. */
export function unhide(links: Links, row: number): void {
  const { left, up, down, top, length } = links;
  let node = row;
  do {
    node = left[node]!;
    length[top[node]!]!++;
    down[up[node]!] = node;
    up[down[node]!] = node;
  } while (node !== row);
}

/** Deshace `cover` en el orden inverso. */
export function uncover(links: Links, header: number): void {
  const { left, right, up, down, top, length } = links;
  for (let row = up[header]!; row !== header; row = up[row]!) {
    for (let node = left[row]!; node !== row; node = left[node]!) {
      length[top[node]!]!++;
      down[up[node]!] = node;
      up[down[node]!] = node;
    }
  }
  right[left[header]!] = header;
  left[right[header]!] = header;
}
