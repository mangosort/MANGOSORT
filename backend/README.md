====================================
BACKEND SETUP INSTRUCTIONS
====================================

1. PLACE YOUR FILES IN backend/ FOLDER:
   - best.pt (your trained YOLO model)
   - data.yaml (your class configuration)

2. INSTALL DEPENDENCIES:
   
   cd backend
   pip install -r requirements.txt

   ⚠️  IMPORTANT: This will download ~2-3 GB for PyTorch/YOLO
      (First time setup takes a while)

3. RUN THE BACKEND SERVER:
   
   python app.py

   Expected output:
   🚀 MANGOSORT Backend API Starting...
   📍 API running at http://localhost:5000

4. TEST THE API (in another terminal):
   
   curl http://localhost:5000/api/health
   
   Should return:
   {"status": "healthy", "model_loaded": true}

====================================
API ENDPOINTS
====================================

GET /api/health
   - Check if API is running
   - No authentication needed

GET /api/classes
   - Get all class names from your model
   - Returns: {"classes": [...], "class_count": 5}

POST /api/predict
   - Run YOLO inference on an image
   - Required: Form data with 'image' file
   - Returns: predictions array with boxes, confidence, class names

====================================
EXAMPLE: SEND IMAGE FOR PREDICTION
====================================

Using Python:
   import requests
   
   with open('mango.jpg', 'rb') as f:
       files = {'image': f}
       response = requests.post('http://localhost:5000/api/predict', files=files)
       print(response.json())

Using cURL:
   curl -X POST -F "image=@mango.jpg" http://localhost:5000/api/predict

====================================
TROUBLESHOOTING
====================================

❌ "best.pt not found"
   → Copy your trained model to backend/ folder

❌ "Model not loading"
   → Check Python/PyTorch installation
   → Run: pip install -r requirements.txt again

❌ Port 5000 already in use
   → Edit app.py, change port to 5001 or 5002
   → Or kill process: lsof -ti:5000 | xargs kill -9

❌ Out of memory error
   → Your GPU might be too small
   → Try CPU mode in app.py (slower but works)

====================================
NEXT STEPS
====================================

1. Copy best.pt and data.yaml to backend/
2. Install dependencies
3. Run the server
4. Update website (script.js) to call http://localhost:5000/api/predict
5. Test image upload functionality

====================================
