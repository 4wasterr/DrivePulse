import { createContext } from 'react'
export const NotificationContext = createContext({ user: null, notifications: [], onRefresh: async () => {} })
