import { createContext, useContext, useEffect, useState } from 'react'

type Theme = 'light' | 'dark'

interface ThemeContextValue {
  theme: Theme
  isDark: boolean
  toggle: () => void
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'light', isDark: false, toggle: () => {}
})

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('infowall-theme')
    if (saved === 'dark' || saved === 'light') return saved
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })

  useEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-theme', theme)
    localStorage.setItem('infowall-theme', theme)
    // Tell browser native elements (scrollbars, inputs) about the scheme
    const meta = document.querySelector('meta[name="color-scheme"]')
    if (meta) meta.setAttribute('content', theme)
  }, [theme])

  function toggle() {
    // Add transition class only during the switch so it doesn't fight other animations
    document.documentElement.classList.add('theme-transitioning')
    setTheme(t => t === 'light' ? 'dark' : 'light')
    setTimeout(() => document.documentElement.classList.remove('theme-transitioning'), 350)
  }

  return (
    <ThemeContext.Provider value={{ theme, isDark: theme === 'dark', toggle }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}