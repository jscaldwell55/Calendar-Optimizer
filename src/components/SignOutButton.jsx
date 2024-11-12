'use client'

import React from 'react'
import { signOut } from "next-auth/react"

const SignOutButton = () => {
  return (
    <button
      onClick={() => signOut({ callbackUrl: "/" })}
      className="px-4 py-2 text-sm text-white bg-red-500 rounded-md hover:bg-red-600 transition-colors"
    >
      Sign Out
    </button>
  )
}

export default SignOutButton
