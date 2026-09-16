from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
c=canvas.Canvas('tests/fixtures/research.pdf',pagesize=(595,842))
c.setTitle('Research preservation fixture')
c.setFillColor(HexColor('#252735'));c.setFont('Helvetica-Bold',23)
c.drawString(55,770,'Reliable model evaluation')
c.setFont('Helvetica',11)
lines=['The Transformer uses attention to combine information.', 'The test used 24 GB of GPU memory and 32 examples per batch.', 'Reported accuracy was 92.5 percent on the held-out dataset.', '', 'Objective: L = sum(x_i * y_i)', '', 'The figure below is part of the original PDF.']
y=722
for line in lines:c.drawString(55,y,line);y-=23
for x,label in [(60,'Input'),(235,'Attention'),(410,'Output')]:
 c.setFillColor(HexColor('#eeeafb'));c.roundRect(x,425,120,65,8,fill=1,stroke=0)
 c.setFillColor(HexColor('#7161d3'));c.setFont('Helvetica-Bold',13);c.drawCentredString(x+60,452,label)
c.setStrokeColor(HexColor('#7161d3'));c.line(180,458,235,458);c.line(355,458,410,458)
c.setFont('Helvetica',10);c.setFillColor(HexColor('#666666'))
c.drawString(55,385,'Figure 1. A simple attention pipeline. Preserve the visual unchanged.')
c.drawString(55,330,'The article does not report GPU model, training time, or dataset license.')
c.drawString(55,60,'Makale integration test fixture - original content - MIT license')
c.save()
