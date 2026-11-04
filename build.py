# Assemble the single-file page: python3 build.py -> aotearoa-land-use.html and index.html (GitHub Pages)
t = open('template.html').read()
t = t.replace('/*MODEL*/', open('model.js').read()).replace('/*GRID*/', open('grid.json').read())
for out in ('aotearoa-land-use.html', 'index.html'):
    open(out, 'w').write(t)
print(f'{len(t) / 1e6:.2f} MB')
