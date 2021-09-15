import { from, Subscription } from 'rxjs'
import { filter, map, switchMap } from 'rxjs/operators'
import sourcegraph, { ExtensionContext } from 'sourcegraph'
import { resolveSettings, Settings } from './settings'

const decorationType = sourcegraph.app.createDecorationType && sourcegraph.app.createDecorationType()
const settings = resolveSettings(sourcegraph.configuration.get<Settings>().value)

export function activate(
    context: ExtensionContext = {
        subscriptions: new Subscription(),
    }
): void {
    context.subscriptions.add(
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
                        `(${singleImport}|${namedImport}|${scopedImport}) lang:python patternType:regexp `
                    )
                }
                return query
            },
        })
    )

    const editorsChanges = sourcegraph.app.activeWindowChanges
        ? from(sourcegraph.app.activeWindowChanges).pipe(
              filter(
                  (activeWindow): activeWindow is Exclude<typeof activeWindow, undefined> => activeWindow !== undefined
              ),
              switchMap(activeWindow =>
                  from(activeWindow.activeViewComponentChanges).pipe(map(() => activeWindow.visibleViewComponents))
              )
          )
        : from(sourcegraph.workspace.openedTextDocuments).pipe(
              map(() => (sourcegraph.app.activeWindow && sourcegraph.app.activeWindow.visibleViewComponents) || [])
          )

    context.subscriptions.add(
        editorsChanges.subscribe(codeEditors => {
            codeEditors.map(codeEditor => {
                if (
                    !settings['pyImports.showAllUsagesLinks'] ||
                    codeEditor.type !== 'CodeEditor' ||
                    codeEditor.document?.languageId !== 'python' ||
                    !codeEditor.document.text
                ) {
                    return
                }

                const text = codeEditor.document.text

                const matches: { lineNumber: number; pkgName: string }[] = []
                const lines = text.split('\n')
                lines.map((line, lineNumber) => {
                    const pyModRegex =
                        /^import\s([^\s]*)$|^import\s([^\s]*)\sas\s[^\\s]*|^from\s[^\s]*\simport\s([^\s^,]*)/
                    const match = pyModRegex.exec(line)
                    if (match && match.length > 1) {
                        // The match index depends on which regex pattern actually produced a match
                        const pkgName = match[1] ? match[1] : match[2] ? match[2] : match[3]
                        matches.push({ lineNumber, pkgName })
                    }
                })

                if (matches.length > 0) {
                    codeEditor.setDecorations(
                        decorationType,
                        matches.map(match => ({
                            range: new sourcegraph.Range(
                                new sourcegraph.Position(match.lineNumber, 0),
                                new sourcegraph.Position(match.lineNumber, 0)
                            ),
                            after: {
                                contentText: 'See all usages',
                                linkURL: '/search?q=py.imports:' + match.pkgName + '&patternType=regexp',
                                backgroundColor: 'pink',
                                color: 'black',
                            },
                        }))
                    )
                }
            })
        })
    )
}
