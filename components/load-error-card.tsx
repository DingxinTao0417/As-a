"use client"

import { CircleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"

export function LoadErrorCard({
  title,
  description,
  retryLabel,
  onRetry,
}: {
  title:string
  description?:string | null
  retryLabel:string
  onRetry:()=>void
}) {
  return <Card className="p-8 text-center" role="alert">
    <CircleAlert className="mx-auto mb-3 h-10 w-10 text-destructive" />
    <p className="font-medium text-destructive">{title}</p>
    {description&&<p className="mt-2 text-sm text-muted-foreground">{description}</p>}
    <Button variant="outline" className="mt-4" onClick={onRetry}>{retryLabel}</Button>
  </Card>
}
