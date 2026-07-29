'use client'

import { useRef } from 'react'
import { modalOverlayStyle } from '../customer/constants'

type Props = {
  onClose: () => void
  children: React.ReactNode
  style?: React.CSSProperties
}

export default function ModalOverlay({ onClose, children, style }: Props) {
  const downOnOverlay = useRef(false)

  return (
    <div
      style={{ ...modalOverlayStyle, ...style }}
      onMouseDown={(e) => { downOnOverlay.current = e.target === e.currentTarget }}
      onMouseUp={(e) => {
        if (downOnOverlay.current && e.target === e.currentTarget) onClose()
        downOnOverlay.current = false
      }}
    >
      {children}
    </div>
  )
}
