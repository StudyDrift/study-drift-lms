"use client"
import type { Active, UniqueIdentifier } from "@dnd-kit/core"
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable"
import type { ReactNode } from "react"
import React, { useMemo, useState } from "react"

import { DragHandle, SortableItem } from "./sortable-item"
import { SortableOverlay } from "./sortable-overlay"

interface BaseItem {
  id: UniqueIdentifier
}

interface Props<T extends BaseItem> {
  id?: string
  items: T[]
  onChange(items: T[]): void
  renderItem(item: T, index: number): ReactNode
}

export function SortableList<T extends BaseItem>({
  items,
  onChange,
  renderItem,
  id,
}: Props<T>) {
  const [active, setActive] = useState<Active | null>(null)
  const activeItem = useMemo(
    () => items.find((item) => item.id === active?.id),
    [active, items]
  )
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  return (
    <DndContext
      sensors={sensors}
      onDragStart={({ active }) => {
        setActive(active)
      }}
      onDragEnd={({ active, over }) => {
        if (over && active.id !== over?.id) {
          const activeIndex = items.findIndex(({ id }) => id === active.id)
          const overIndex = items.findIndex(({ id }) => id === over.id)

          onChange(arrayMove(items, activeIndex, overIndex))
        }
        setActive(null)
      }}
      onDragCancel={() => {
        setActive(null)
      }}
      id={"dnd-" + id}
    >
      <SortableContext items={items} id={id}>
        {items.map((item, idx) => (
          <React.Fragment key={item.id}>{renderItem(item, idx)}</React.Fragment>
        ))}
      </SortableContext>
      <SortableOverlay>
        {activeItem ? renderItem(activeItem, -1) : null}
      </SortableOverlay>
    </DndContext>
  )
}

SortableList.Item = SortableItem
SortableList.DragHandle = DragHandle
