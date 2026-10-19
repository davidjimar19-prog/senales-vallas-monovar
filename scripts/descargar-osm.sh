#!/usr/bin/env bash
# Uso: scripts/descargar-osm.sh "<municipio>" ["<provincia/region opcional>"]
# Descarga el extracto OSM del término municipal (Overpass) y genera GeoJSON servido localmente.
set -euo pipefail
MUN="${1:?Indica el municipio, ej: scripts/descargar-osm.sh Monóvar Alicante}"
REG="${2:-}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"; OUT="$DIR/data/osm"; mkdir -p "$OUT"
UA="senales-vallas/1.0 (ayuntamiento)"
echo "Buscando $MUN en Nominatim..."
Q=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$MUN ${REG} España")
curl -s -A "$UA" "https://nominatim.openstreetmap.org/search?q=$Q&format=json&limit=5&featuretype=city&polygon_geojson=0" > "$OUT/nominatim.json"
read -r RELID S N W E LAT LON NAME < <(python3 - "$OUT/nominatim.json" <<'PY'
import json,sys
r=[x for x in json.load(open(sys.argv[1])) if x.get('osm_type')=='relation']
if not r: sys.exit("No se encontró relación administrativa")
x=r[0];b=x['boundingbox']
print(x['osm_id'],b[0],b[1],b[2],b[3],x['lat'],x['lon'],x['display_name'].split(',')[0].replace(' ','_'))
PY
)
echo "Relación $RELID  bbox S=$S N=$N W=$W E=$E"
AREA=$((3600000000+RELID))
QUERY="[out:xml][timeout:180];area($AREA)->.a;(relation($RELID);way(area.a)[highway];way(area.a)[building];way(area.a)[landuse];way(area.a)[waterway];node(area.a)[place][name];);(._;>;);out body;"
echo "Descargando extracto de Overpass..."
OK=0
for i in 1 2 3 4; do
  for EP in https://overpass-api.de/api/interpreter https://overpass.kumi.systems/api/interpreter https://maps.mail.ru/osm/tools/overpass/api/interpreter https://overpass.private.coffee/api/interpreter; do
    echo "  intento $i: $EP"
    curl -s -m 200 -A "$UA" --data-urlencode "data=$QUERY" "$EP" -o "$OUT/municipio.osm" || true
    if grep -q "<osm" "$OUT/municipio.osm" 2>/dev/null && grep -q "<way" "$OUT/municipio.osm"; then OK=1; break 2; fi
  done; sleep $((i*10))
done
grep -q "<osm" "$OUT/municipio.osm" || { echo "Error Overpass"; head -c 500 "$OUT/municipio.osm"; exit 1; }
echo "Convirtiendo a GeoJSON..."
node "$DIR/node_modules/osmtogeojson/osmtogeojson" -m "$OUT/municipio.osm" > "$OUT/municipio.geojson"
cat > "$OUT/meta.json" <<J
{"nombre":"${NAME//_/ }","relacion":$RELID,"centro":[$LAT,$LON],"bbox":[[$S,$W],[$N,$E]],"fecha":"$(date -u +%FT%TZ)"}
J
cat "$OUT/meta.json"; ls -lh "$OUT"
