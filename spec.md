## Contexto de archivo ( irremovible )
spec.md es un archivo de tipo SDD para proporcionar de instrucciones y guias al agente de IA ( Sea Claude, Copilot, Gemini, etc ) tenga claros los límites y objetivos del proyecto y sus metas en el momento actual.

# Directrices de funcionamiento ( irremovible )
- El Agente debe leer este archivo, junto con el CHANGELOG.md y AI_CONTEXT.md, antes de iniciar cambios.
- El usuario debe escribir el problema a resolver, o el cambio a realizar, debajo de INST
- Ningún cambio se aprueba por el agente, se consulta al usuario primero
- Cada cambio debe ser detallado si se crearon archivos o si se modificaron archivos existentes
- Cada cambio debe pasar por tests antes de dar conclusiones al respecto
- De ser exitosos los tests, se procede a actualizar CHANGELOG.md y AI_CONTEXT.md, y explicar lo realizado
- Una vez actualizados, se elimina el contenido debajo de INST

# INST