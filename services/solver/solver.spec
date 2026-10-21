# PyInstaller spec for the standalone local Solver.
from pathlib import Path
from PyInstaller.utils.hooks import collect_data_files

hiddenimports = ['ortools.sat.python.cp_model', 'ortools.sat.cp_model_pb2']
datas = collect_data_files('ortools.sat')
ortools_dir = Path(__import__('ortools').__file__).parent
binaries = [(str(p), 'ortools/.libs') for p in (ortools_dir / '.libs').glob('*.dll')]

a = Analysis(
    ['services/solver/solver.py'],
    pathex=['services/solver'],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['pandas', 'matplotlib', 'numpy', 'numba', 'tkinter'],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, a.binaries, a.datas, [], name='warpweft-solver', console=True)
