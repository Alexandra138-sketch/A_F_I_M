import json
import sys
from jsonschema import Draft202012Validator

# uso: python validar.py <schema> <documento>
with open(sys.argv[1], encoding="utf-8") as f:
    schema = json.load(f)
with open(sys.argv[2], encoding="utf-8") as f:
    doc = json.load(f)

Draft202012Validator.check_schema(schema)
erros = list(Draft202012Validator(schema).iter_errors(doc))

if erros:
    for e in erros:
        print("INVALIDO:", e.message)
else:
    print("VALIDO")