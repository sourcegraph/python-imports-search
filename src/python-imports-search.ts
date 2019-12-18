import { EMPTY, from, of } from 'rxjs'
import { concatMap, toArray } from 'rxjs/operators'
import * as sourcegraph from 'sourcegraph'

export function activate(): void {
    sourcegraph.search.registerQueryTransformer({
        transformQuery: (query: string) => {
            console.log('transforming query')
            const pyImportsRegex = /\bpy.imports:([^\s]*)/i
            console.log('query', query)
            if (query.match(pyImportsRegex)) {
                const pyImportsFilter = query.match(pyImportsRegex)
                const pyPkg = pyImportsFilter && pyImportsFilter.length >= 1 ? pyImportsFilter[1] : ''
                const singleImport = '^import\\s' + pyPkg + '$'
                const namedImport = '^import\\s' + pyPkg + '\\sas\\s[^\\s]*'
                const scopedImport = '^from\\s(.*)\\simport\\s(.*)' + pyPkg
                return query.replace(pyImportsRegex, `(${singleImport}|${namedImport}|${scopedImport}) lang:python `)
            }
            console.log(query)
            return query
        },
    })

    sourcegraph.workspace.onDidOpenTextDocument.subscribe(doc => {
        console.log(doc.languageId)
        if (doc.languageId !== 'python') {
            return
        }
        console.log('on did open doc')
        from(doc.text.split('\n'))
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
                console.log('matches', matches)
                if (!matches) {
                    return
                }
                if (sourcegraph.app.activeWindow && sourcegraph.app.activeWindow.visibleViewComponents.length > 0) {
                    console.log('matching decorations')
                    sourcegraph.app.activeWindow.visibleViewComponents[0].setDecorations(
                        null,
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
    })
}
