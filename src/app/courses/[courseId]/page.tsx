"use client"
import { redirect, useParams } from "next/navigation"

export default function Page() {
  const { courseId } = useParams<{ courseId: string }>()
  return redirect(`/courses/${courseId}/home`)
}
