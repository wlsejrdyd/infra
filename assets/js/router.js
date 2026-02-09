// assets/js/router.js

class Router {
  constructor() {
    this.routes = {};
    this.currentRoute = null;
    this.params = {};
    
    // URL 변경 감지
    window.addEventListener('hashchange', () => this.handleRouteChange());
    window.addEventListener('load', () => this.handleRouteChange());
  }

  /**
   * 라우트 등록
   * @param {string} path - 경로 (예: '/overview', '/server/:id')
   * @param {Function} handler - 핸들러 함수
   */
  addRoute(path, handler) {
    this.routes[path] = handler;
  }

  /**
   * 경로 매칭 및 파라미터 추출
   * @param {string} path - 라우트 패턴
   * @param {string} url - 실제 URL
   * @returns {Object|null}
   */
  matchRoute(path, url) {
    const pathParts = path.split('/').filter(Boolean);
    const urlParts = url.split('/').filter(Boolean);

    if (pathParts.length !== urlParts.length) {
      return null;
    }

    const params = {};

    for (let i = 0; i < pathParts.length; i++) {
      if (pathParts[i].startsWith(':')) {
        // 파라미터 추출
        const paramName = pathParts[i].slice(1);
        params[paramName] = urlParts[i];
      } else if (pathParts[i] !== urlParts[i]) {
        return null;
      }
    }

    return params;
  }

  /**
   * 라우트 변경 처리
   */
  handleRouteChange() {
    const hash = window.location.hash.slice(1) || '/overview';
    let matched = false;

    for (const [path, handler] of Object.entries(this.routes)) {
      const params = this.matchRoute(path, hash);
      
      if (params !== null) {
        this.currentRoute = path;
        this.params = params;
        handler(params);
        matched = true;
        break;
      }
    }

    if (!matched) {
      // 404 - 기본 페이지로 리다이렉트
      this.navigate('/overview');
    }
  }

  /**
   * 페이지 이동
   * @param {string} path - 이동할 경로
   */
  navigate(path) {
    window.location.hash = path;
  }

  /**
   * 현재 라우트 정보
   * @returns {Object}
   */
  getCurrentRoute() {
    return {
      path: this.currentRoute,
      params: this.params
    };
  }
}

// 싱글톤 인스턴스 export
export const router = new Router();
