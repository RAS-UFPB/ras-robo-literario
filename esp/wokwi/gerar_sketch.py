"""Gera o sketch do Wokwi diretamente do firmware oficial, sem forks da lógica.

Uso: python esp/wokwi/gerar_sketch.py
"""
from pathlib import Path

here = Path(__file__).resolve().parent
principal = (here.parent / "robo_literario_codigo.ino").read_text(encoding="utf-8")
intro = ("// ARQUIVO GERADO: edite esp/robo_literario_codigo.ino, nunca este.\n"
         "// Para atualizar: python esp/wokwi/gerar_sketch.py\n"
         "#define ROBO_SIMULADOR_WOKWI 1\n\n")
(here / "sketch.ino").write_text(intro + principal, encoding="utf-8")
print("Gerado: esp/wokwi/sketch.ino (mesma lógica do firmware físico)")
