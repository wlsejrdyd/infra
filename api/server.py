#!/usr/bin/env python3
from flask import Flask, request, jsonify
from flask_cors import CORS
import json
import os

app = Flask(__name__)
CORS(app)

SERVERS_FILE = '/app/infra/assets/data/servers.json'

@app.route('/api/servers', methods=['GET'])
def get_servers():
    """서버 목록 조회"""
    try:
        with open(SERVERS_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return jsonify(data), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/servers', methods=['POST'])
def save_servers():
    """서버 목록 저장"""
    try:
        data = request.get_json()
        
        # 유효성 검사
        if not data or 'servers' not in data:
            return jsonify({'error': 'Invalid data format'}), 400
        
        # 파일 저장
        with open(SERVERS_FILE, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        
        return jsonify({'success': True, 'message': 'Servers saved successfully'}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/health', methods=['GET'])
def health():
    """헬스체크"""
    return jsonify({'status': 'ok'}), 200

if __name__ == '__main__':
    # 개발 환경: 디버그 모드
    # 운영 환경: gunicorn 사용 권장
    app.run(host='127.0.0.1', port=5000, debug=False)
