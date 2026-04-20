/* eslint-disable react-refresh/only-export-components -- context module exports provider + hooks */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

export type BlockEditorContextValue = {
  selectedId: string | null
  setSelectedId: (id: string | null) => void
  disabled: boolean
}

const BlockEditorContext = createContext<BlockEditorContextValue | null>(null)

type BlockEditorProviderProps = {
  children: ReactNode
  disabled?: boolean
  /** When a block is removed from data, the resolved selection becomes null. */
  validBlockIds: readonly string[]
}

export function BlockEditorProvider({ children, disabled, validBlockIds }: BlockEditorProviderProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const selectedIdResolved =
    selectedId !== null && validBlockIds.includes(selectedId) ? selectedId : null

  const value = useMemo(
    () => ({
      selectedId: selectedIdResolved,
      setSelectedId,
      disabled: disabled ?? false,
    }),
    [selectedIdResolved, disabled],
  )

  return <BlockEditorContext.Provider value={value}>{children}</BlockEditorContext.Provider>
}

export function useBlockEditor(): BlockEditorContextValue {
  const ctx = useContext(BlockEditorContext)
  if (!ctx) {
    throw new Error('useBlockEditor must be used within BlockEditorProvider')
  }
  return ctx
}

/** Optional hook for presentational components that may render outside the provider. */
export function useBlockEditorOptional(): BlockEditorContextValue | null {
  return useContext(BlockEditorContext)
}

export function useSelectBlock(blockId: string) {
  const { setSelectedId } = useBlockEditor()
  return useCallback(() => {
    setSelectedId(blockId)
  }, [blockId, setSelectedId])
}
