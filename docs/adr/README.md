# Registros de decisiones de arquitectura (ADR)

Una decisión técnica por archivo, con el nombre `NNNN-titulo-en-minusculas.md` (por ejemplo, `0001-stack.md`).

## Plantilla

```markdown
# NNNN — Título

- Estado: propuesta | aceptada | reemplazada por NNNN
- Fecha: AAAA-MM-DD

## Contexto
Qué problema o fuerza obliga a decidir.

## Decisión
Qué se decide.

## Alternativas consideradas
Opciones descartadas y por qué.

## Consecuencias
Qué se gana, qué se pierde y qué queda pendiente.
```

## Índice

| N.º | Título | Estado |
|---|---|---|
| [0001](0001-stack.md) | Stack tecnológico | aceptada |
| [0002](0002-tiempo-real.md) | Comunicación en tiempo real (`ws` + protocolo propio) | aceptada |
| [0003](0003-persistencia.md) | Persistencia (memoria + PostgreSQL, reconstrucción tras reinicio) | aceptada |
| [0004](0004-registro-de-eventos.md) | Registro de eventos por partida | aceptada |
| [0005](0005-notas-grupales.md) | Notas grupales | aceptada |
| [0006](0006-banco-como-manifiesto.md) | Banco de puzzles como manifiesto de semillas | aceptada |
| [0007](0007-hosting.md) | Hosting: Render (servidor y web estática) y Neon (PostgreSQL) | aceptada |
