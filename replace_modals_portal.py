import sys

files = [
    'src/components/passenger/CharterModal.tsx',
    'src/components/passenger/PrivateDriverModal.tsx',
    'src/components/passenger/CargoModal.tsx'
]

for file_path in files:
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            code = f.read()

        if 'import { createPortal } from \'react-dom\';' not in code:
            code = code.replace('import React, {', 'import React, {')
            code = "import { createPortal } from 'react-dom';\n" + code

        code = code.replace('return (\n    <div className="fixed', 'return createPortal(\n    <div className="fixed')
        code = code.replace('</div>\n  );\n}', '</div>,\n    document.body\n  );\n}')
        code = code.replace('</div>\n  );\n};', '</div>,\n    document.body\n  );\n};')
        
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(code)
        
        print(f"Updated {file_path}")
    except Exception as e:
        print(f"Error in {file_path}: {e}")
