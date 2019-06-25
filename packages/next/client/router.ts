/* global window */
import React from 'react'
import Router, { BaseRouter } from 'next-server/dist/lib/router/router'
import { RouterContext } from 'next-server/dist/lib/router-context'
import { RequestContext } from 'next-server/dist/lib/request-context'

type ClassArguments<T> = T extends new (...args: infer U) => any ? U : any

type RouterArgs = ClassArguments<typeof Router>

type SingletonRouterBase = {
  router: Router | null
  readyCallbacks: Array<() => any>
  ready(cb: () => any): void
}

export { Router }

export type PublicRouterInstance = BaseRouter &
  Pick<
    Router,
    'push' | 'replace' | 'reload' | 'back' | 'prefetch' | 'beforePopState'
  > & {
    events: typeof Router['events']
  }

export type SingletonRouter = SingletonRouterBase & PublicRouterInstance

const singletonRouter: SingletonRouterBase = {
  router: null, // holds the actual router instance
  readyCallbacks: [],
  ready(cb: () => void) {
    if (this.router) return cb()
    if (typeof window !== 'undefined') {
      this.readyCallbacks.push(cb)
    }
  },
}

// Create public properties and methods of the router in the singletonRouter
const urlPropertyFields = ['pathname', 'route', 'query', 'asPath']
const propertyFields = ['components']
const routerEvents = [
  'routeChangeStart',
  'beforeHistoryChange',
  'routeChangeComplete',
  'routeChangeError',
  'hashChangeStart',
  'hashChangeComplete',
]
const coreMethodFields = [
  'push',
  'replace',
  'reload',
  'back',
  'prefetch',
  'beforePopState',
]

// Events is a static property on the router, the router doesn't have to be initialized to use it
Object.defineProperty(singletonRouter, 'events', {
  get() {
    return Router.events
  },
})

propertyFields.concat(urlPropertyFields).forEach(field => {
  // Here we need to use Object.defineProperty because, we need to return
  // the property assigned to the actual router
  // The value might get changed as we change routes and this is the
  // proper way to access it
  Object.defineProperty(singletonRouter, field, {
    get() {
      const router = getRouter() as any
      return router[field] as string
    },
  })
})

coreMethodFields.forEach(field => {
  // We don't really know the types here, so we add them later instead
  ;(singletonRouter as any)[field] = (...args: any[]) => {
    const router = getRouter() as any
    return router[field](...args)
  }
})

routerEvents.forEach(event => {
  singletonRouter.ready(() => {
    Router.events.on(event, (...args) => {
      const eventField = `on${event.charAt(0).toUpperCase()}${event.substring(
        1
      )}`

      getTimings(event, ...args) // measure performance timings during route change

      const _singletonRouter = singletonRouter as any
      if (_singletonRouter[eventField]) {
        try {
          _singletonRouter[eventField](...args)
        } catch (err) {
          // tslint:disable-next-line:no-console
          console.error(`Error when running the Router event: ${eventField}`)
          // tslint:disable-next-line:no-console
          console.error(`${err.message}\n${err.stack}`)
        }
      }
    })
  })
})

function getTimings(event: string, routeName: string) {
  let longTaskCheck

  if (event === 'routeChangeStart') {
    performance.mark('routeChangeStart')
  } else if (event === 'routeChangeComplete') {
    const observer = new PerformanceObserver(list => {
      const perfEntries = list.getEntries()
      for (let i = 0; i < perfEntries.length; i++) {
        clearTimeout(longTaskCheck) //if long task is observed, clear timeout
        longTaskCheck = setTimeout(
          () => mainThreadIdle(observer, perfEntries, routeName),
          800 // if no long tasks are observed in 800ms, calculate time it took for thread to settle
        )
      }
    })

    observer.observe({ entryTypes: ['longtask'] })
  }
}

function mainThreadIdle(
  observer: PerformanceObserver,
  perfEntries: PerformanceEntry[],
  routeName: string
) {
  const routeStartTime = performance.getEntriesByName(
    'routeChangeStart',
    'mark'
  )[0].startTime
  const timeToIdle = perfEntries.reduce(
    (max, task) =>
      task.startTime + task.duration > max
        ? task.startTime + task.duration
        : max,
    perfEntries[0].startTime + perfEntries[0].duration
  )
  const routeTTI = Math.round(timeToIdle - routeStartTime)

  console.log(
    `Navigating to ${routeName} took ${routeTTI}ms to become interactive`
  )

  performance.clearMarks()
  performance.clearMeasures()
  observer.disconnect()
}

function getRouter() {
  if (!singletonRouter.router) {
    const message =
      'No router instance found.\n' +
      'You should only use "next/router" inside the client side of your app.\n'
    throw new Error(message)
  }
  return singletonRouter.router
}

// Export the singletonRouter and this is the public API.
export default singletonRouter as SingletonRouter

// Reexport the withRoute HOC
export { default as withRouter } from './with-router'

export function useRouter() {
  return React.useContext(RouterContext)
}

export function useRequest() {
  return React.useContext(RequestContext)
}

// INTERNAL APIS
// -------------
// (do not use following exports inside the app)

// Create a router and assign it as the singleton instance.
// This is used in client side when we are initilizing the app.
// This should **not** use inside the server.
export const createRouter = (...args: RouterArgs) => {
  singletonRouter.router = new Router(...args)
  singletonRouter.readyCallbacks.forEach(cb => cb())
  singletonRouter.readyCallbacks = []

  return singletonRouter.router
}

// This function is used to create the `withRouter` router instance
export function makePublicRouterInstance(router: Router): PublicRouterInstance {
  const _router = router as any
  const instance = {} as any

  for (const property of urlPropertyFields) {
    if (typeof _router[property] === 'object') {
      instance[property] = { ..._router[property] } // makes sure query is not stateful
      continue
    }

    instance[property] = _router[property]
  }

  // Events is a static property on the router, the router doesn't have to be initialized to use it
  instance.events = Router.events

  propertyFields.forEach(field => {
    // Here we need to use Object.defineProperty because, we need to return
    // the property assigned to the actual router
    // The value might get changed as we change routes and this is the
    // proper way to access it
    Object.defineProperty(instance, field, {
      get() {
        return _router[field]
      },
    })
  })

  coreMethodFields.forEach(field => {
    instance[field] = (...args: any[]) => {
      return _router[field](...args)
    }
  })

  return instance
}
