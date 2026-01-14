import os
import cv2
import numpy as np
import torch
from flask import Flask, request, jsonify, Response
from flask_cors import CORS
from PIL import Image
import io
from datetime import datetime
import threading

app = Flask(__name__)
CORS(app)  # Allow requests from your website

# Load YOLO model
MODEL_PATH = 'best.pt'
if not os.path.exists(MODEL_PATH):
    print(f"WARNING: {MODEL_PATH} not found. Place your trained model in the backend folder.")
    model = None
else:
    model = torch.hub.load('ultralytics/yolov5', 'custom', path=MODEL_PATH, force_reload=False)

# Video stream variables
cap = cv2.VideoCapture(0)
cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

latest_detections = {
    'unripe': 0,
    'ripe': 0,
    'overripe': 0,
    'rotten': 0,
    'last_updated': None
}

detection_lock = threading.Lock()

@app.route('/api/health', methods=['GET'])
def health():
    """Check if API is running"""
    return jsonify({'status': 'healthy', 'model_loaded': model is not None})

@app.route('/api/predict', methods=['POST'])
def predict():
    """Run YOLO inference on uploaded image"""
    
    if model is None:
        return jsonify({'error': 'Model not loaded. Please add best.pt to backend folder.'}), 400
    
    # Check if image is in request
    if 'image' not in request.files:
        return jsonify({'error': 'No image provided'}), 400
    
    file = request.files['image']
    
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
    
    try:
        # Read image
        image = Image.open(io.BytesIO(file.read()))
        
        # Run YOLO inference
        results = model(image)
        
        # Extract predictions
        predictions = []
        result = results.xyxy[0]  # YOLOv5 format
        
        for det in result:
            pred = {
                'x': float(det[0]),
                'y': float(det[1]),
                'width': float(det[2] - det[0]),
                'height': float(det[3] - det[1]),
                'confidence': float(det[4]),
                'class_id': int(det[5]),
                'class': model.names[int(det[5])]
            }
            predictions.append(pred)
        
        return jsonify({
            'success': True,
            'predictions': predictions,
            'image_shape': [image.size[1], image.size[0], 3]
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/api/classes', methods=['GET'])
def get_classes():
    """Get available class names"""
    
    if model is None:
        return jsonify({'error': 'Model not loaded'}), 400
    
    return jsonify({
        'classes': model.names,
        'class_count': len(model.names)
    })

# ===== VIDEO STREAM =====
def generate_frames():
    """Generate video frames with YOLO detection"""
    global latest_detections
    
    frame_count = 0
    while True:
        success, frame = cap.read()
        if not success:
            break
        
        frame_count += 1
        annotated = frame.copy()
        
        # Run detection every 2 frames for performance
        if frame_count % 2 == 0 and model is not None:
            try:
                # Run YOLO inference
                results = model(frame)
                
                # Reset counts for this frame
                frame_detections = {
                    'unripe': 0,
                    'ripe': 0,
                    'overripe': 0,
                    'rotten': 0
                }
                
                # Draw detections
                for det in results.xyxy[0]:
                    x1, y1, x2, y2, conf, cls_id = det.cpu().numpy()
                    cls_id = int(cls_id)
                    cls_name = model.names[cls_id]
                    confidence = float(conf)
                    
                    # Count by class
                    if cls_name.lower() in frame_detections:
                        frame_detections[cls_name.lower()] += 1
                    
                    # Draw bounding box
                    x1, y1, x2, y2 = int(x1), int(y1), int(x2), int(y2)
                    
                    # Color based on class
                    colors = {
                        'unripe': (255, 165, 0),    # Orange
                        'ripe': (0, 255, 0),        # Green
                        'overripe': (0, 165, 255),  # Orange/red
                        'rotten': (0, 0, 255)       # Red
                    }
                    color = colors.get(cls_name.lower(), (0, 255, 0))
                    
                    cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 2)
                    label = f"{cls_name} {confidence:.2f}"
                    cv2.putText(annotated, label, (x1, y1 - 10),
                              cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)
                
                # Update global detections
                with detection_lock:
                    latest_detections = {
                        'unripe': frame_detections['unripe'],
                        'ripe': frame_detections['ripe'],
                        'overripe': frame_detections['overripe'],
                        'rotten': frame_detections['rotten'],
                        'last_updated': datetime.now().isoformat()
                    }
                
            except Exception as e:
                print(f"Detection error: {e}")
        
        # Add status text
        with detection_lock:
            status = f"Unripe: {latest_detections['unripe']} | Ripe: {latest_detections['ripe']} | Overripe: {latest_detections['overripe']} | Rotten: {latest_detections['rotten']}"
        cv2.putText(annotated, status, (10, 30),
                  cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
        
        # Encode frame
        ret, buffer = cv2.imencode('.jpg', annotated)
        if not ret:
            continue
        
        frame_bytes = buffer.tobytes()
        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')

@app.route('/api/video', methods=['GET'])
def video():
    """Video stream endpoint"""
    response = Response(generate_frames(),
                       mimetype='multipart/x-mixed-replace; boundary=frame')
    response.headers['Access-Control-Allow-Origin'] = '*'
    return response

@app.route('/api/detections', methods=['GET'])
def get_detections():
    """Get current detection counts"""
    with detection_lock:
        return jsonify(latest_detections)

if __name__ == '__main__':
    print("🚀 MANGOSORT Backend API Starting...")
    print("📍 API running at http://localhost:5000")
    print("📝 Available endpoints:")
    print("   - GET  /api/health       (Check if API is running)")
    print("   - GET  /api/classes      (Get class names)")
    print("   - POST /api/predict      (Run YOLO inference)")
    print("\n⚠️  Make sure 'best.pt' is in the backend folder!")
    
    app.run(debug=False, port=5000, use_reloader=False)
