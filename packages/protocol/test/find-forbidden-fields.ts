// Recorre los tipos exportados por un módulo y devuelve las rutas a cualquier propiedad con un
// nombre prohibido. Lo usa T-31.3.
import path from "node:path";
import ts from "typescript";

const MAX_DEPTH = 8;

function compilerOptions(): ts.CompilerOptions {
  const configPath = path.resolve(import.meta.dirname, "../tsconfig.json");
  const parsed = ts.getParsedCommandLineOfConfigFile(
    configPath,
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
      },
    },
  );
  if (!parsed) throw new Error(`Cannot read ${configPath}`);
  return parsed.options;
}

export function findForbiddenFields(entryFile: string, forbidden: readonly string[]): string[] {
  const program = ts.createProgram({ rootNames: [entryFile], options: compilerOptions() });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(entryFile);
  const moduleSymbol = source && checker.getSymbolAtLocation(source);
  if (!moduleSymbol) throw new Error(`Cannot resolve module ${entryFile}`);

  const hits: string[] = [];
  const visited = new Set<ts.Type>();

  // Los tipos de librerías (lib.d.ts, Zod...) no se recorren por dentro: solo sus argumentos de
  // tipo, que es donde viajan nuestras formas (Array<T>, Record<K, T>, ZodObject<Shape>...).
  // Los tipos mapeados sí se recorren, porque sus propiedades salen de nuestras claves.
  const isExternal = (type: ts.Type): boolean => {
    if (
      type.flags & ts.TypeFlags.Object &&
      (type as ts.ObjectType).objectFlags & ts.ObjectFlags.Mapped
    ) {
      return false;
    }
    const declarations = (type.aliasSymbol ?? type.getSymbol())?.getDeclarations() ?? [];
    return (
      declarations.length > 0 &&
      declarations.every((declaration) => {
        const file = declaration.getSourceFile();
        return (
          program.isSourceFileDefaultLibrary(file) || program.isSourceFileFromExternalLibrary(file)
        );
      })
    );
  };

  const typeArguments = (type: ts.Type): readonly ts.Type[] => {
    const fromReference =
      type.flags & ts.TypeFlags.Object &&
      (type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference
        ? checker.getTypeArguments(type as ts.TypeReference)
        : [];
    return [...fromReference, ...(type.aliasTypeArguments ?? [])];
  };

  const walk = (type: ts.Type, where: string, depth: number): void => {
    if (depth > MAX_DEPTH || visited.has(type)) return;
    visited.add(type);

    if (type.isUnionOrIntersection()) {
      for (const member of type.types) walk(member, where, depth + 1);
    }
    for (const argument of typeArguments(type)) walk(argument, `${where}<>`, depth + 1);
    if (isExternal(type)) return;

    for (const property of checker.getPropertiesOfType(type)) {
      const propertyPath = `${where}.${property.name}`;
      if (forbidden.includes(property.name)) hits.push(propertyPath);
      walk(checker.getTypeOfSymbol(property), propertyPath, depth + 1);
    }
    for (const info of checker.getIndexInfosOfType(type)) {
      walk(info.type, `${where}[]`, depth + 1);
    }
    for (const signature of [...type.getCallSignatures(), ...type.getConstructSignatures()]) {
      walk(signature.getReturnType(), `${where}()`, depth + 1);
      for (const parameter of signature.getParameters()) {
        walk(checker.getTypeOfSymbol(parameter), `${where}(${parameter.name})`, depth + 1);
      }
    }
  };

  for (const exported of checker.getExportsOfModule(moduleSymbol)) {
    const symbol =
      exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
    if (symbol.flags & ts.SymbolFlags.Type) {
      walk(checker.getDeclaredTypeOfSymbol(symbol), exported.name, 0);
    }
    if (symbol.flags & ts.SymbolFlags.Value) {
      walk(checker.getTypeOfSymbol(symbol), exported.name, 0);
    }
  }
  return [...new Set(hits)].sort();
}
