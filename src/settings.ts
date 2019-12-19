export interface Settings {
    ['pyImports.showAllUsagesLinks']: boolean
}

export function resolveSettings(raw: Partial<Settings>): Settings {
    return {
        ['pyImports.showAllUsagesLinks']: !!raw['pyImports.showAllUsagesLinks'],
    }
}
