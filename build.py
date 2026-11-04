# Assemble the single-file page: python3 build.py -> aotearoa-land-use.html
t = open('template.html').read()
t = t.replace('/*MODEL*/', open('model.js').read()).replace('/*GRID*/', open('grid.json').read())
open('aotearoa-land-use.html', 'w').write(t)
