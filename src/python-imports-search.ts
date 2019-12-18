import { EMPTY, from, of } from 'rxjs'
import { concatMap, filter, map, switchMap, toArray } from 'rxjs/operators'
import * as sourcegraph from 'sourcegraph'

const decorationType = sourcegraph.app.createDecorationType && sourcegraph.app.createDecorationType()
export function activate(): void {
    sourcegraph.search.registerQueryTransformer({
        transformQuery: (query: string) => {
            const pyImportsRegex = /\bpy.imports:([^\s]*)/i
            if (query.match(pyImportsRegex)) {
                const pyImportsFilter = query.match(pyImportsRegex)
                const pyPkg = pyImportsFilter && pyImportsFilter.length >= 1 ? pyImportsFilter[1] : ''
                const singleImport = '^import\\s' + pyPkg + '$'
                const namedImport = '^import\\s' + pyPkg + '\\sas\\s[^\\s]*'
                const scopedImport = '^from\\s(.*)\\simport\\s(.*)' + pyPkg

                return query.replace(
                    pyImportsRegex,
                    `(${singleImport}|${namedImport}|${scopedImport}) lang:python patternType:regexp`
                )
            }
            return query
        },
    })

    const editorsChanges = sourcegraph.app.activeWindowChanges
        ? from(sourcegraph.app.activeWindowChanges).pipe(
              filter(
                  (activeWindow): activeWindow is Exclude<typeof activeWindow, undefined> => activeWindow !== undefined
              ),
              switchMap(activeWindow =>
                  from(activeWindow.activeViewComponentChanges).pipe(map(() => activeWindow.visibleViewComponents))
              )
          )
        : from(sourcegraph.workspace.onDidOpenTextDocument).pipe(
              map(() => (sourcegraph.app.activeWindow && sourcegraph.app.activeWindow.visibleViewComponents) || [])
          )

    editorsChanges.subscribe(codeEditor => {
        const document = codeEditor[0].document
        if (document.languageId !== 'python') {
            return
        }

        if (document.text) {
            from(document.text.split('\n'))
                .pipe(
                    concatMap((line, lineNumber) => {
                        const pyModRegex = /^import\s([^\s]*)$|^import\s([^\s]*)\sas\s[^\\s]*|^from\s[^\s]*\simport\s([^\s^,]*)/
                        const match = pyModRegex.exec(line)
                        if (match && match.length > 1) {
                            // The match index depends on which regex pattern actually produced a match
                            const pkgName = match[1] ? match[1] : match[2] ? match[2] : match[3]
                            return of({ lineNumber, pkgName })
                        }
                        return EMPTY
                    }),
                    toArray()
                )
                .subscribe(matches => {
                    if (!matches) {
                        return
                    }
                    if (codeEditor.length > 0) {
                        codeEditor[0].setDecorations(
                            decorationType,
                            matches.map(match => ({
                                range: new sourcegraph.Range(
                                    new sourcegraph.Position(match.lineNumber, 0),
                                    new sourcegraph.Position(match.lineNumber, 0)
                                ),
                                after: {
                                    contentText: 'See all usages',
                                    linkURL: '/search?q=py.imports:' + match.pkgName,
                                    backgroundColor: 'pink',
                                    color: 'black',
                                },
                            }))
                        )
                    }
                })
        }
    })
}
