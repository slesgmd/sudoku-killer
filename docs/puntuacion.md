# Puntuación (F6)

Cómo se puntúa una partida del modo Normal, cómo se eligieron los parámetros y qué se sabe de sus límites. Las reglas verificables son R-02, R-03, R-19, R-32 y R-36, más T-35.7 y T-35.8 del motor (SPEC 1.5). El código está en `packages/scoring` (puntuación pura) y en `apps/server/scripts/scoring-sim/` (simulador).

## 1. Parámetros vigentes (v1)

`packages/scoring/src/params.v1.json`, validado con Zod al cargar:

| Parámetro | Valor | Qué es |
|---|---|---|
| B | 10 | Puntos de una celda de nivel 1 |
| w(1) a w(5) | 1, 2, 3, 4, 5 | Peso del nivel de la celda |
| P | 90 | Lo que resta un error, además de la vida |
| β | 1 | Bonus por cada fila, columna, caja o jaula que cierra un acierto |
| H | 60 | Lo que resta una pista a quien la usa (H = B·w(5) + 10) |

El esquema exige que w no decrezca, que B·w(L) sea entero (los puntos son enteros) y que las penalizaciones no sean negativas.

## 2. Fórmulas

- **Acierto:** `V = B × w(nivel)` más β por cada unidad que cierra. El nivel es `levelToDeduce` sobre el estado anterior a la jugada, con los dígitos colocados y los **descartes públicos** (abajo). Va de 1 a 5: en el banco nunca es `UNRATED` (T-20.5). Un acierto da entre 10 y 54 puntos.
- **Error:** −P y una vida menos (R-03).
- **Pista:** −H para quien la usa. Nadie recibe β, aunque la pista cierre unidades (T-19.5). La celda no le da V a nadie.
- **Desempate (R-02):** primero el puntaje; a igual puntaje, menos errores; después, menor `scoreReachedAt` (el momento del último cambio de puntaje). Si todo empata, comparten posición (1, 1, 3) y se muestran por apodo.
- **Determinismo (R-32):** `puntaje = scoreLog(hechos, parámetros)`. Un hecho lleva su contexto: el nivel y las unidades cerradas de un acierto. Con otra versión de los parámetros, la misma partida se recalcula sin tocar el registro (T-32.4).

**Descartes públicos.** El dígito de un error es un hecho que todos ven (`cell.mistake`). `levelToDeduce` lo quita de los candidatos de su celda (`BoardState.excluded`, `docs/motor.md`). Un error nunca es el dígito de la solución, así que el descarte no la contradice, y con más descartes ningún nivel sube (T-35.8). Sin esto, quien adivina entre 2 candidatos y falla sabe que el otro es el correcto, y cobraría el nivel alto en el segundo intento: la estrategia «probar hasta acertar» pagaría.

**El bonus β nunca se suma a una celda difícil.** La última celda de una unidad siempre es de nivel 1 (`hiddenSingle` o `cageLastCell`). Por eso β no entra en la condición de adivinar, pero sí premia cerrar, que es lo que hace quien corre por las celdas fáciles. Por eso β quedó en 1.

### API para F9 (`packages/scoring`)

- `createScoring(params)` devuelve `{ onCorrect, onMistake, onHint }` con las firmas de `GameMode` (SPEC §5). Sus contextos son tipos mínimos a los que `PlacementContext` es asignable, así que el modo Normal las usa sin adaptarlas (T-36.5). `onCorrect` devuelve un `ScoreChange` `correct` y uno `closure` por unidad, en el orden de `closedUnits`, para armar `bonuses`.
- `scoreLog(events, params, players?)` da por jugador `score`, `mistakes` y `scoreReachedAt`. `scoreReachedAt` es el `at` más alto de los hechos que cambiaron su puntaje: en un registro en orden es el último cambio, y así no depende del orden de los hechos que no se afectan (T-36.4).
- `rankPlayers(entries)` ordena el ranking.
- `pointsFor(level, params)` lanza `RangeError` con un nivel fuera de 1 a 5, porque eso sería un error del servidor.

**Recomendaciones para F9:**
- Guardar `level` y `graderVersion` en el evento de un acierto. Así, recalcular con otros parámetros no depende de la versión del calificador, y la reproducción no necesita volver a calificar.
- Mantener en `Match` los descartes públicos (`excluded`, SPEC §2.3), derivados de los eventos `cell.mistake`.

## 3. Condiciones analíticas

**Adivinar (corregida en el punto de control).** Un adivinador de nivel s ve 2 candidatos en el punto fijo de sus técnicas, en una celda de nivel L > s. Prueba uno: con probabilidad ½ acierta y cobra B·w(L). Si falla, paga −P y, con el descarte, la celda pasa a nivel ≤ s, así que el segundo intento cobra a lo sumo B·w(s). El valor esperado de «probar hasta acertar» es ½·B·w(L) + ½·(−P + B·w(s)), negativo si y solo si:

**P > B·(w(L) + w(s))**

- La primera versión del plan decía w(1) en vez de w(s). Después de un error, la celda queda en el nivel en que se veían los 2 candidatos, no en el nivel 1.
- k = 2 es el peor caso: con más candidatos el valor esperado baja.
- Con w = 1/2/3/4/5, el peor caso es L = 5 y depende de s: B·(w(5) + w(s)) da 60, 70, 80 y 90 para s = 1 a 4. P = 90 cubre a los adivinadores de nivel ≤ 3 (P > 80). **El peor caso, s = 4, queda documentado y no se fuerza:** con P = 90 su valor esperado es 0, y un adivinador que ya domina el nivel 4 rara vez necesita adivinar.

**Robo con pista.** Si X pide pista sobre la celda que Y está pensando, Y pierde V y X paga H: la diferencia entre ambos cambia en V − H. No compensa si H ≥ V máx. = B·w(5) = 50. H = 60.

## 4. Simulador

`pnpm --filter @sudoku-killer/server scoring:simulate` (y `scoring:calibrate` para la grilla). Simulación de eventos discretos en tiempo virtual sobre los 2000 puzzles del banco, regenerados desde el manifiesto con sus números iniciales.

**Modelo del mundo** (supuestos del simulador, no parámetros de la puntuación):
- **Tiempo para pensar una celda de nivel L:** `velocidad × T(L) × ruido lognormal (σ = 0,5)`. El perfil base es T = 6, 15, 35, 70 y 140 s. Para la robustez hay dos perfiles más, uno plano (8, 14, 22, 32 y 45 s) y otro empinado (5, 15, 50, 120 y 300 s).
- **Velocidad de cada bot:** lognormal (σ = 0,35).
- **Descuidos:** un dígito falso en el 1 % de las jugadas deducidas.
- **Reacción:** 1,5 s para notar que otro bloqueó la celda que se estaba pensando (R-05). Si el bloqueo llega antes, el bot elige otra; si no, envía la jugada y recibe «ya resuelta», sin penalización.

**Bots:**
- **Lógico** (técnicas hasta el nivel 5): elige al azar entre las celdas que puede deducir, sin mirar la dificultad.
- **Veloz** (hasta el nivel 5): elige siempre la de menor nivel.
- **Adivinador** (hasta el nivel 2 o 3): deduce lo que alcanza. Si no encuentra nada, toma la celda con menos candidatos en su punto fijo y prueba hasta acertar.
- **Vidas:** cada bot tiene 3; con 0 pasa a espectador y deja de jugar. Si todos son espectadores, es derrota (R-01, R-03).
- **Pistas:** son 3 compartidas. Un bot con política de pistas pide una con probabilidad 0,5 cuando todo lo que tiene a mano es de nivel 4 o más; el adivinador, cuando no encuentra nada, antes de adivinar.

**Bloques** (por puzzle: 3 partidas del A, 1 del B y 1 del C; 10 000 en total):
- **A, mesas generales** de 2 a 6 bots al azar. Se usan para el aporte, la equidad, el Spearman, β y la comparación de adivinar: cada partida tiene una rama en la que los adivinadores, en lugar de adivinar, deducen la celda más fácil fuera de su alcance con el tiempo de su nivel.
- **B, duelos:** un veloz y un lógico con la misma velocidad, más 0 a 4 bots al azar.
- **C, pistas:** tres ramas con el mismo azar: sin pista; con una pista forzada (sobre la celda más difícil del tablero o, en la mitad de los casos, sobre la celda difícil que otro bot está pensando, el «robo»); y un **placebo**, que espera lo mismo que la pista y no la pide. La partida se desvía en cualquier rama, así que el placebo mide cuánto cambia el puntaje solo por esa desviación.

Los bots no reaccionan a la puntuación, así que cada registro se puntúa con cualquier conjunto de parámetros, y también con el modelo de velocidad, sin volver a simular.

**Modelo de comparación por velocidad** (`scoring-sim/baseline.ts`): `max(5, round(base(dificultad) × e^(−Δt/30 s)))`, con base de 60, 80, 100 y 120 por dificultad y Δt el tiempo desde la jugada anterior del mismo jugador. Cada fila, columna o caja completada multiplica por 1 + 0,5. Un error resta 30 y una pista, nada.

## 5. Aporte real, independiente de la fórmula

**Definición:** el aporte de un jugador es lo que el equipo tarda de más sin él: `(T sin él − T con todos) / T con todos`. Se mide volviendo a simular la partida sin ese asiento, con el mismo azar para los demás. Si el equipo no termina, se toma 3 × T.

**Por qué es independiente:**
- No usa B, w, P, β ni H, ni el nivel como medida.
- El nivel solo interviene en el modelo del mundo, que hace de verdad conocida: dice cuánto se tarda en pensar.
- Un veloz que toma celdas que otro habría tomado igual aporta poco tiempo. Quien destraba el cuello de botella aporta mucho.

**Réplicas y techo.**
- Con una sola medición, el aporte es ruidoso: dos réplicas con otro azar del mundo se correlacionan entre 0,39 y 0,81 según la mesa (validación).
- Por eso el aporte es la media de varias réplicas: 4 en la calibración y 8 en la validación.
- Con 8 réplicas, la confiabilidad estimada (Spearman-Brown) va de 0,83 a 0,97 según el estrato, y su raíz, de 0,91 a 0,99, es el **techo** de la correlación de cualquier puntaje con el aporte medido.

**Cómo se compara:**
- **Spearman** por estrato (dificultad × tamaño de mesa), sobre valores normalizados en cada partida, más el agrupado.
- **Equidad:** la cuota de puntaje de cada tipo de bot frente a su cuota de aporte. Se cuentan las partes positivas, con 100 como la parte justa de la mesa; en el duelo, la cuota del veloz dentro del par y el porcentaje de duelos que gana por puntaje y por aporte.

## 6. Tiempo de la simulación

- **Estimación ingenua:** el veloz necesita el nivel de todas las celdas vacías en cada decisión. Eso da unos 4 s por partida, unas 11 h para 10 000 partidas y unas 55 h con el aporte contrafáctico.
- **Cómo se redujo, sin cambiar los resultados:**
  - `levelsToDeduce` calcula todas las celdas en una pasada por estado, y da lo mismo que celda por celda (T-35.7);
  - memoria por estado (dígitos y descartes), compartida entre las partidas y las ramas de un puzzle;
  - hilos de trabajo: cada partida sale solo de su semilla, así que el resultado no depende de cuántos hilos haya (T-36.6);
  - calibrar recalculando los puntajes, sin volver a simular.
- **Medido:**
  - unos 55 ms por simulación y 1 ms por estado analizado;
  - la validación, con 441 628 simulaciones (8 réplicas y los dos perfiles alternativos), tardó 13,5 minutos en 31 hilos, unas 6,9 h de CPU;
  - la prueba del corpus (10 000 partidas, sin réplicas), 79 s.

## 7. Punto de control: parámetros iniciales y cambio de metas

**Parámetros iniciales:** B = 10, w = 1/1,5/2/3/4, P = 60, β = 2 y H = 50. Primera corrida con la semilla 1 y 4 réplicas:

| Métrica | Meta del plan | Inicial | Modelo de velocidad |
|---|---|---|---|
| Spearman agrupado | ≥ 0,8 | 0,82 | 0,84 |
| Spearman, mínimo por estrato | ≥ 0,8 | 0,51 | 0,62 |
| El veloz gana a un lógico de igual velocidad | ≤ 55 % | 62,8 % | 65,6 % |
| Pista: Δ medio (placebo) | ≤ 0 | −52,5 (−5,4) | −73,9 |
| β en los puntos | ≤ 20 % | 14 % (p95 18 %) | — |

**Hallazgos:**
1. **El aporte independiente muestra que el veloz y el lógico aportan lo mismo.** En los duelos, el aporte del veloz supera al del lógico en el 49,2 %; en mesas generales, los dos tienen una cuota de aporte de 0,99. La meta del 55 % suponía que el lógico aportaba más. El problema real era otro: la puntuación le daba al veloz más cuota que su aporte (1,00 frente a 0,91 del lógico).
2. **Bajar los duelos al 55 % exigía pesos casi proporcionales a T(L)** (1/2,5/6/12/24). Con eso, la condición de adivinar pedía P ≈ 370 y H ≈ 250, entre 2 y 3 veces el puntaje mediano de un jugador, y el Spearman caía a 0,55.
3. **El Spearman de 0,8 en cada estrato está en el techo de la medición** para las mesas grandes de experto.

**Metas que reemplazaron a las del plan** (decisión del usuario en el punto de control):
- **Equidad entre veloz y lógico:** la cuota de puntaje de cada uno no se aparta más de 5 puntos de su cuota de aporte, en mesas generales y en duelos. Además, el porcentaje de duelos que gana el veloz queda a ±5 puntos del porcentaje en que su aporte supera al del lógico.
  - **El adivinador queda fuera a propósito.** El diseño busca que adivinar no se premie aunque aporte tiempo al equipo: un error público hasta le descarta un dígito a los demás. Que su puntaje quede por debajo de su aporte es el comportamiento buscado.
- **Spearman:** ≥ 0,8 agrupado y, en cada estrato, ≥ 80 % del techo de confiabilidad.
- **Adivinar:** P mínimo que cumpla la condición analítica y dé un valor esperado empírico negativo frente a deducir.
- **Pistas:** H = B·w(5) + 10; el efecto neto de la pista y del robo, ≤ 0.
- **β** de 1 o 2, con ≤ 20 % de los puntos.

## 8. Calibración

`scoring:calibrate`, con los registros de la semilla 1 y 4 réplicas.
- **Grilla:** w(2) ∈ {1,5; 2}, w(3) ∈ {2; 2,5; 3}, w(4) ∈ {3; 3,5; 4} y w(5) ∈ {4; 4,5; 5}, sin decrecer, con β ∈ {1; 2}: 81 combinaciones.
- **En cada combinación:** P es el primer múltiplo de 5 que supera B·(w(5) + w(2)) por 10, y H = B·w(5) + 10.

**Ninguna combinación cumplió la equidad.** La más cercana, 1/2/3/4/5 con β = 1, quedó en 10,2 puntos. La traban los duelos (el veloz gana el 59,4 %, frente al 49,2 % que le da el aporte) y la cuota del adivinador (94 frente a 104), que abre P. Fuera de la grilla, solo los pesos 1/2,5/6/12/24 con P = 80 y H = 60 bajaban de 5 puntos, y violan las reglas de P y H.

**Decisión del usuario:**
- w = 1/2/3/4/5, β = 1, H = 60 y P = 90, que cumple P > B·(w(5) + w(3)) = 80;
- equidad solo entre veloz y lógico, informada como limitación conocida;
- para el adivinador de nivel 2, valor esperado negativo frente a deducir con su intervalo de confianza; para el de nivel 3, con su media.

## 9. Validación

Semillas nuevas (semilla base 2), 10 000 partidas, 8 réplicas del aporte y los dos perfiles alternativos de T(L) sobre una submuestra fija (uno de cada 4 bloques de 4 puzzles, uno por dificultad): 2500 partidas por perfil. Sin recalibrar.

**Metas exigidas:**

| Meta | Base | Base, submuestra | Plano | Empinado |
|---|---|---|---|---|
| P > B·(w(5) + w(3)) | 90 > 80 ✓ | ✓ | ✓ | ✓ |
| H = B·w(5) + 10 | 60 ✓ | ✓ | ✓ | ✓ |
| Adivinar frente a deducir, nivel 2: media (IC 95 % superior) | −70,5 (−63,2) ✓ | −60,0 (−46,6) ✓ | −45,2 (−34,1) ✓ | −67,1 (−52,9) ✓ |
| Adivinar frente a deducir, nivel 3: media | −2,4 ✓ | −6,9 ✓ | −10,3 ✓ | −5,2 ✓ |
| Pista, efecto neto frente al placebo (media) | −54,5 ✓ | −53,8 ✓ | −52,3 ✓ | −52,6 ✓ |
| Robo, efecto neto frente al placebo (media) | −43,5 ✓ | −38,4 ✓ | −36,2 ✓ | −52,2 ✓ |
| β en los puntos (p95) | 9,9 % ✓ | 9,9 % ✓ | 9,9 % ✓ | 9,9 % ✓ |

**Informativas** (limitaciones conocidas, sección 10):

| Métrica | Base | Base, submuestra | Plano | Empinado |
|---|---|---|---|---|
| Adivinar, nivel 3: IC 95 % superior | +0,6 | +0,3 | −4,3 | +3,5 |
| Equidad veloz y lógico: diferencia máxima | 8,9 | 9,8 | 5,6 | 9,4 |
| Duelos que gana el veloz (por aporte) | 57,4 % (48,6 %) | 57,8 % (48,0 %) | 47,8 % (42,2 %) | 57,0 % (51,6 %) |
| Spearman agrupado | 0,78 | 0,78 | 0,82 | 0,74 |
| Peor estrato frente a su techo | 0,56 | 0,59 | 0,69 | 0,46 |

**Detalle del perfil base:**
- **Cuotas puntaje / aporte (100 = parte justa):** lógico 98,5 / 99,6; veloz 104,7 / 97,7; adivinador 95,0 / 105,0. En el duelo, el veloz tiene 52,0 / 49,7 dentro del par.
- **Modelo de velocidad, con los mismos registros:** el veloz gana el 66,3 % de los duelos y la diferencia de equidad llega a 17,7 puntos. El modelo propio reduce la ventaja de correr por las celdas fáciles, aunque no la elimina. El modelo de velocidad tiene un Spearman agrupado más alto (0,85), porque en este mundo el aporte medido en tiempo premia también la cantidad de celdas.
- **Pista sin el placebo:** Δ medio de −60,6. Rama por rama, la pista dio más puntos en el 6,0 % de las ramas, frente al 30,0 % del placebo: esos casos son la desviación de la partida, no la pista.
- **Adivinar:** los episodios «probar hasta acertar» son claramente negativos, −37,4 en el nivel 2 y −20,6 en el nivel 3. Hay 0,6 adivinanzas por adivinador y el 52,8 % de ellas fallan.
- **Por qué el nivel 3 queda en el límite frente a deducir:** cuando un adivinador de nivel 3 no encuentra nada, lo que queda son celdas de nivel 4 o 5, y su alternativa es deducirlas, con 70 a 140 s por celda. Adivinar ahorra ese tiempo, y lo que suma en ese tiempo casi compensa los errores. En el nivel 2, la alternativa es una celda de nivel 3 (35 s), y adivinar sale claramente peor.
- **Puntos por segundo de cada nivel** (B·w(L) / tiempo medio de pensar, niveles 1 a 5): base 1,47 · 1,18 · 0,76 · 0,50 · 0,32; plano 1,10 · 1,26 · 1,20 · 1,10 · 0,98; empinado 1,76 · 1,18 · 0,53 · 0,29 · 0,15.
- **Nivel de la celda al decidir y al puntuar:** la celda que un bot piensa a veces se vuelve más fácil mientras otros juegan. Al lógico le pasa en el 4,5 % de sus aciertos, y no explica la ventaja del veloz.
- **Derrotas:** 1 en 2000 partidas de experto y ninguna en las demás dificultades. Termina sin vidas el 6,4 % de los adivinadores, el 0,1 % de los lógicos y el 0,1 % de los veloces.

**Puntaje típico, mediana / p95:**

| Dificultad | Jugador | Equipo | P / jugador mediano | H / jugador mediano |
|---|---|---|---|---|
| Fácil | 115 / 284 | 562 / 567 | 78 % | 52 % |
| Media | 136 / 330 | 652 / 665 | 66 % | 44 % |
| Difícil | 179 / 443 | 813 / 911 | 50 % | 34 % |
| Experto | 217 / 601 | 984 / 1183 | 41 % | 28 % |

## 10. Limitaciones conocidas

Quedan registradas sin seguir persiguiéndolas en la v1; se revisan con partidas reales (sección 11).
- **Ventaja del veloz:** gana alrededor del 57 % al 59 % de los duelos contra un lógico de igual velocidad, cuando su aporte supera al del lógico en el 49 %. En mesas generales su cuota de puntaje supera a la de aporte en unos 7 puntos. Cerrarlo exige pesos proporcionales a T(L), con P y H desproporcionados.
- **Spearman agrupado** alrededor de 0,78 a 0,79, por debajo de 0,8.
- **Estratos de experto por debajo del techo:** entre 0,46 y 0,69 del techo en el peor estrato, según el perfil.
- **Adivinador de nivel 3:** su media frente a deducir es negativa, pero el intervalo de confianza toca el 0 con los perfiles base y empinado. El peor caso analítico (s = 4) tiene valor esperado 0.
- **Dependencia del modelo del mundo:** los T(L) son un supuesto. Con el perfil plano, la equidad y el Spearman casi se cumplen (5,6 puntos y 0,82); con el empinado, empeoran (9,4 y 0,74). Las metas exigidas se cumplen con los tres. El aporte medido en tiempo supone que las celdas son trabajo en paralelo: si en la realidad las deducciones difíciles destraban más de lo que el modelo supone, el lógico vale más de lo que aquí se mide.
- **Rama por rama, una pista puede dar más puntos** por la desviación de la partida (alrededor del 6 % de las ramas). En media nunca la da.

## 11. Recalibración con partidas reales (F11 y F13)

El registro de eventos permite recalcular cualquier partida con parámetros nuevos (T-32.4), así que la recalibración no necesita volver a jugar.

**Primera prioridad: el tamaño de P.** Hoy un error equivale al 78 % del puntaje mediano de un jugador en fácil (66 % en media, 50 % en difícil y 41 % en experto). Es duro para los descuidos honestos, que en el simulador son el 1 % de las jugadas. Qué medir con los registros reales:
- la tasa de errores por descuido frente a la de adivinanzas, separándolas por señales del registro: el tiempo desde la jugada anterior del mismo jugador, un error repetido en la misma celda, el nivel de la celda y si el error repite el dígito de una celda bloqueada (D6);
- el puntaje por jugador y por equipo en cada dificultad (mediana y p95), para expresar P y H en proporción;
- cuántas veces un jugador acierta enseguida en la celda donde acaba de equivocarse (la marca de «probar hasta acertar»).

Si los descuidos dominan, la opción prevista es **escalar P por dificultad** (por ejemplo, en proporción al puntaje típico), manteniendo P > B·(w(5) + w(3)) en las dificultades donde hay celdas de nivel 5 que adivinar. Exigiría una versión nueva de los parámetros, con P por dificultad.

**Además:**
- **T(L) reales:** el tiempo entre la selección de una celda (presencia) y su acierto, por nivel. Reemplaza el supuesto del modelo del mundo y dice qué perfil se parece más a la realidad.
- **Ventaja del veloz:** la cuota de puntaje de los jugadores que eligen sobre todo celdas de nivel 1, frente a su efecto en el tiempo del equipo.
- **β:** su proporción en los puntos (hoy alrededor del 7 % de mediana) y si cerrar unidades cambia la conducta.
- **Pistas:** quién las usa, sobre qué nivel de celda y si alguna cae sobre la celda que otro tenía seleccionada (robo).
- **Ranking:** cuántas partidas se definen por desempate.

### Herramienta de análisis: `scoring:report` (F11h)

`pnpm --filter @sudoku-killer/server scoring:report [--since AAAA-MM-DD] [--limit 500] [--out informe.json]` lee las partidas terminadas de la base (`DATABASE_URL`), las reproduce con el reductor y da, por dificultad: partidas y victorias; puntaje por jugador y por equipo (mediana y p95); **P frente al puntaje mediano de un jugador**; aciertos, errores y tasa de errores; las señales de cada error (tiempo desde la acción anterior del mismo jugador, error repetido en la misma celda, error evidente porque el dígito ya está bloqueado en su fila, columna o caja, y nivel de la celda, que es el del acierto posterior en ella); «probar hasta acertar» (el mismo jugador acierta la celda en menos de 30 s tras fallarla); pistas por jugador; la parte de los puntos que viene del cierre de unidades (β); partidas definidas por desempate y empates exactos; y una **estimación de T(L)**: el tiempo entre jugadas del mismo jugador, por nivel de la celda resuelta.

Solo lee: no cambia parámetros ni filas. **La decisión sobre P y una versión nueva de los parámetros quedan para F13** (decisión del usuario en el plan de F11), con las partidas de la beta. Limitaciones, que el informe también lista: T(L) es una cota superior (el intervalo incluye otras celdas y las notas) y el «robo» de pistas no se puede medir, porque la presencia no se guarda (T(L) medido de forma directa queda fuera de la v1: `docs/IDEAS_FUTURAS.md`, sección 8). La prueba `apps/server/test/scoring-report.test.ts` comprueba los conteos sobre el registro de una partida jugada contra el servidor de pruebas.

Hasta F11 no hay partidas reales para analizar: las partidas internas son tiempo de personas, fuera de las horas de F11, y las de la prueba de carga son de clientes automáticos (aciertos y errores al azar), así que solo sirven para comprobar que la herramienta corre sobre miles de partidas, no para calibrar.

## 12. Cómo se ejecuta

- `pnpm --filter @sudoku-killer/server scoring:simulate [--games 10000] [--base-seed 2] [--replicates 8] [--robustness-every 4] [--params archivo.json]`: imprime todo lo de la sección 9 y escribe el informe en JSON en el directorio temporal del sistema.
- `pnpm --filter @sudoku-killer/server scoring:calibrate [--base-seed 1] [--replicates 4]`: la grilla de la sección 8.
- **Pruebas:**
  - CI: `packages/scoring/test/scoring.test.ts` (T-02.1 a T-02.3, T-19.5, T-32.4 y T-36.1 a T-36.5), `packages/engine/test/levels.test.ts` (T-35.7 y T-35.8) y `apps/server/test/scoring-sim.test.ts` (determinismo, reglas de las partidas y T-19.6 reducida).
  - `pnpm test:corpus`: `apps/server/test/scoring-sim.corpus.test.ts` repite la validación (semilla 2, 10 000 partidas, sin réplicas) y exige las metas de la sección 9 (T-19.6 y T-36.6). Usa una semilla fija porque la media del nivel 3 está cerca del límite: con 1000 partidas y la semilla 1 da +5,7, y con otras semillas el ruido decidiría el signo.
